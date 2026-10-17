import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import { SessionDriver } from "../lib/drivers/session.js"
import type { FaultProxy } from "../lib/faults/proxy.js"
import { Ledger } from "../lib/ledger.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

const sequences = Number(process.env.CHAOS_SEQUENCES ?? 3)

const length = Number(process.env.CHAOS_ACTIONS ?? 20)

const actions = [
  "send-shell",
  "send-text",
  "queue",
  "cut-hand",
  "cut-user",
  "issuer-503",
  "provider-503",
  "restart-executor",
  "restart-cell",
] as const

interface Sent {
  readonly messageId: Session.MessageID
  readonly marker: string | undefined
  readonly accepted: boolean
}

describe.skipIf(Platform.wrangler !== undefined)("seeded fault sequences across every link", () => {
  const lane: { stack?: Stack.Instance; hand?: Stack.Hand } = {}

  const current = () => {
    if (!lane.stack || !lane.hand) throw new Error("the stack did not start")
    return { stack: lane.stack, hand: lane.hand }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.hand = await lane.stack.hand("chaos")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  test.each(Array.from({ length: sequences }, (_, index) => Wait.seed + index))(
    `seed %i: ${length} actions keep every accepted message once and every tool effect at most once`,
    async (seed) => {
      const stack = current().stack
      const hand = current().hand
      const random = Wait.random("seeded", seed)
      const access = () => stack.access(Stack.freshKey("seeded"), Date.now() + 4 * 60_000)
      stack.issuer.next(() => ({ type: "grant", access: access() }))
      const session = await stack.session({
        models: access(),
        hand,
      })
      const rules: Array<FaultProxy.Rule> = []
      const send = async (
        steps: ReadonlyArray<ModelProvider.Step>,
        marker: string | undefined,
        delivery: Session.Delivery,
      ): Promise<Sent> => {
        const messageId = Session.MessageID.create()
        const attempt = () =>
          session.turn(steps, marker ?? "chaos", { messageId, delivery }).then(
            () => true,
            () => false,
          )
        return { messageId, marker, accepted: (await attempt()) || (await attempt()) }
      }
      const effects: Readonly<Record<(typeof actions)[number], () => Promise<Sent | undefined>>> = {
        "send-shell": () => {
          const marker = Ledger.marker("seeded")
          return send(
            [ModelProvider.tool("shell", { command: Ledger.append(marker) }), ModelProvider.text("ok")],
            marker,
            "steer",
          )
        },
        "send-text": () => send([ModelProvider.text("plain")], undefined, "steer"),
        queue: () => send([ModelProvider.text("queued")], undefined, "queue"),
        "cut-hand": async () => void hand.proxy.cutAll(),
        "cut-user": async () => void stack.cellProxy.cutAll(),
        "issuer-503": async () =>
          void rules.push(
            stack.issuerProxy.inject({ operation: "POST /brain/models/refresh" }, { type: "status", status: 503 }),
          ),
        "provider-503": async () =>
          void rules.push(
            stack.providerProxy.inject({ operation: "POST /v1/chat/completions" }, { type: "status", status: 503 }),
          ),
        "restart-executor": () => hand.instance.restart().then(() => undefined),
        "restart-cell": () => stack.restartCell().then(() => undefined),
      }
      const sent = await Array.from(
        { length },
        () => actions[random.integer(0, actions.length - 1)] ?? "send-text",
      ).reduce<Promise<ReadonlyArray<Sent>>>(async (previous, action) => {
        const done = await previous
        // ast-grep-ignore: no-test-sleep -- the seeded gap between actions is part of the sequence
        await Bun.sleep(random.integer(0, 400))
        const result = await effects[action]()
        return result ? [...done, result] : done
      }, Promise.resolve([]))
      for (const rule of rules) rule.cancel()
      await session.closed(240_000)
      const read = await session.messages()
      const accepted = sent.filter((entry) => entry.accepted)
      expect(accepted.map((entry) => SessionDriver.occurrences(read, entry.messageId))).toEqual(accepted.map(() => 1))
      const counts = await Promise.all(
        sent.flatMap((entry) => (entry.marker ? [Ledger.count(hand.instance, entry.marker)] : [])),
      )
      expect(counts.filter((count) => count > 1)).toEqual([])
    },
    600_000,
  )
})
