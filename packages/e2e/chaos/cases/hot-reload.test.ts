import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Session } from "@ren/schema/session"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"
import { Wait } from "../lib/wait.js"

// oxlint-disable-next-line ren/no-comments -- spec §9.1: the lane pulls every 5 s, longer than a held tool call, so a change that reaches the next step of that call came by push.
const pullIntervalMs = 5000

const heldMs = 3000

const sequences = Number(process.env.CHAOS_SEQUENCES ?? 3)

const length = Number(process.env.CHAOS_ACTIONS ?? 12)

const pushes = /^POST \/ren\/pull$/

const pulls = /^POST \/host\/pull$/

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined)(
  "hot reload on the real chain: write, trigger, NOTIFY, BrainPush, /ren/pull, pull, OpenCode (spec §9.1)",
  () => {
    const lane: { stack?: RealStack.Instance } = {}

    const current = () => {
      if (!lane.stack) throw new Error("the stack did not start")
      return lane.stack
    }

    beforeAll(async () => {
      lane.stack = await RealStack.start({
        environments: [{ label: "hot-reload" }],
        cellVars: { PULL_INTERVAL_MS: String(pullIntervalMs) },
      })
    }, 300_000)

    afterAll(() => lane.stack?.dispose())

    const instruct = (text: string) =>
      current().sql`
        INSERT INTO settings (space_id, settings)
        VALUES (${current().owner.spaceId}, ${JSON.stringify({ instructions: text, permissions: [], references: [] })}::text::jsonb)
        ON CONFLICT (owner_id) DO UPDATE SET settings = excluded.settings, updated_at = now()`

    const rule = () => `Rule ${crypto.randomUUID()}.`

    // oxlint-disable-next-line ren/no-comments -- The first model call runs a shell command for heldMs; the write lands while it runs; the second call is the next step.
    const midTurn = async (session: RealStack.Driver, write: () => Promise<unknown>) => {
      const script = await session.turn([
        ModelProvider.tool("shell", { command: `sleep ${heldMs / 1000}` }),
        ModelProvider.text("ok"),
      ])
      await script.called(1, 60_000)
      await write()
      const next = await script.called(2, 60_000)
      await session.idle(60_000)
      return next
    }

    const started = async () => {
      const session = await current().session()
      await session.start()
      const boot = await session.turn([ModelProvider.text("ready")])
      await boot.called(1, 60_000)
      await session.idle(60_000)
      return session
    }

    test("C1: a settings write during a tool call reaches the next step of that turn by push", async () => {
      const session = await started()
      const written = rule()
      const before = current().cellProxy.count(pushes)
      const next = await midTurn(session, () => instruct(written))
      expect(next.system).toContain(written)
      expect(current().cellProxy.count(pushes)).toBeGreaterThan(before)
    }, 300_000)

    test("C4: a lost push delays the change to the next timed pull and never loses it", async () => {
      const session = await started()
      const written = rule()
      const dropped = current().cellProxy.inject({ operation: "POST /ren/pull" }, { type: "refuse" }, 1000)
      try {
        const next = await midTurn(session, () => instruct(written))
        expect(next.system).not.toContain(written)
        // ast-grep-ignore: no-test-sleep -- the change must come by the cell's own timer
        await Bun.sleep(pullIntervalMs + 2000)
        const after = await session.turn([ModelProvider.text("after")])
        expect((await after.called(1, 60_000)).system).toContain(written)
      } finally {
        dropped.cancel()
      }
    }, 300_000)

    test("C5: 200 writes in one second to one space give each brain a few pulls, not 200", async () => {
      await started()
      const pulled = current().renProxy.count(pulls)
      const writing = Date.now()
      await Promise.all(Array.from({ length: 200 }, (_, index) => instruct(`Storm ${index}.`)))
      expect(Date.now() - writing).toBeLessThan(5000)
      // ast-grep-ignore: no-test-sleep -- the pushes of the storm settle within a pull time
      await Bun.sleep(3000)
      expect(current().renProxy.count(pulls) - pulled).toBeLessThan(20)
    }, 300_000)

    test("C6: after the server's LISTEN connection is cut, the server listens again and pushes the next write", async () => {
      const session = await started()
      await current().sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE 'LISTEN %'`
      await Wait.until("the server to listen again", 30_000, async () =>
        (await current().sql`SELECT pid FROM pg_stat_activity WHERE query LIKE 'LISTEN %'`).length > 0 ? true : undefined,
      )
      const written = rule()
      const next = await midTurn(session, () => instruct(written))
      expect(next.system).toContain(written)
    }, 300_000)

    test("C7: archiving a busy chat stops its turn within 2 s, and the model gets no more requests for it", async () => {
      const session = await started()
      const script = await session.turn([ModelProvider.tool("shell", { command: "sleep 20" }), ModelProvider.text("late")])
      await script.called(1, 60_000)
      const at = Date.now()
      await current().sql`UPDATE agent_session SET archived_at = now() WHERE id = ${session.sessionId}`
      await session.idle(10_000)
      expect(Date.now() - at).toBeLessThan(5000)
      // ast-grep-ignore: no-test-sleep -- a turn that kept running would ask the model again after its 20 s command
      await Bun.sleep(2000)
      expect(script.calls).toHaveLength(1)
    }, 300_000)

    test("C10: a cell killed between the push and its pull applies the change at boot", async () => {
      const session = await started()
      const held = current().renProxy.inject({ operation: "POST /host/pull" }, { type: "refuse" }, 1)
      const written = rule()
      await instruct(written)
      await Wait.until("the push's pull to be refused", 10_000, () => (held.applied() ? true : undefined))
      await current().restartCell()
      const after = await session.turn([ModelProvider.text("after crash")])
      expect((await after.called(1, 120_000)).system).toContain(written)
      await session.idle(60_000)
    }, 300_000)

    test("C11: with Ren down an open brain keeps its state; after Ren returns its timed pull brings the change (I1)", async () => {
      const session = await started()
      const written = rule()
      const script = await session.turn([ModelProvider.tool("shell", { command: "sleep 15" }), ModelProvider.text("ok")])
      await script.called(1, 60_000)
      current().renProxy.partition(true)
      try {
        await instruct(written)
        // ast-grep-ignore: no-test-sleep -- Ren stays down for more than one pull interval
        await Bun.sleep(pullIntervalMs + 1000)
      } finally {
        current().renProxy.partition(false)
      }
      expect((await script.called(2, 60_000)).system).toContain(written)
      await session.idle(60_000)
    }, 300_000)

    const actions = ["write", "write", "turn", "drop-pushes", "ren-down", "restart-cell", "archive-other"] as const

    test.each(Array.from({ length: sequences }, (_, index) => Wait.seed + 300 + index))(
      `seed %i: ${length} actions, then 30 s quiet: the brain has the last write, and every chat is idle (I1, I3, I7)`,
      async (seed) => {
        const stack = current()
        const random = Wait.random("hot-reload", seed)
        const session = await started()
        const others: Array<Session.ID> = []
        const healing: Array<Promise<void>> = []
        const state = { last: "" }
        const effects: Readonly<Record<(typeof actions)[number], () => Promise<void>>> = {
          write: async () => {
            state.last = rule()
            await instruct(state.last)
          },
          turn: async () => {
            const script = await session.turn([
              ModelProvider.tool("shell", { command: `sleep ${random.integer(0, 2)}` }),
              ModelProvider.text("ok"),
            ])
            await script.called(1, 60_000).catch(() => undefined)
          },
          "drop-pushes": async () => {
            const dropping = stack.cellProxy.inject({ operation: "POST /ren/pull" }, { type: "refuse" }, random.integer(1, 5))
            // ast-grep-ignore: no-test-sleep -- the seeded length of the fault is part of the sequence
            healing.push(Bun.sleep(random.integer(1000, 6000)).then(() => dropping.cancel()))
          },
          "ren-down": async () => {
            stack.renProxy.partition(true)
            // ast-grep-ignore: no-test-sleep -- the seeded length of the fault is part of the sequence
            healing.push(Bun.sleep(random.integer(1000, 6000)).then(() => stack.renProxy.partition(false)))
          },
          "restart-cell": () => stack.restartCell(),
          "archive-other": async () => {
            const other = await stack.session()
            await other.start()
            others.push(other.sessionId)
            await stack.sql`UPDATE agent_session SET archived_at = now() WHERE id = ${other.sessionId}`
          },
        }
        await Array.from({ length }, () => actions[random.integer(0, actions.length - 1)] ?? "write").reduce<
          Promise<void>
        >(async (previous, action) => {
          await previous
          // ast-grep-ignore: no-test-sleep -- the seeded gap between actions is part of the sequence
          await Bun.sleep(random.integer(0, 500))
          await effects[action]()
        }, Promise.resolve())
        await Promise.all(healing)
        stack.renProxy.partition(false)
        if (!state.last) {
          state.last = rule()
          await instruct(state.last)
        }
        // ast-grep-ignore: no-test-sleep -- I1: 30 s after the last write every open brain has Ren's state
        await Bun.sleep(30_000)
        await session.idle(60_000)
        const check = await session.turn([ModelProvider.text("check")])
        expect((await check.called(1, 60_000)).system).toContain(state.last)
        await session.idle(60_000)
      },
      900_000,
    )
  },
)
