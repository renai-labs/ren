import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import { SessionDriver } from "../lib/drivers/session.js"
import { Ledger } from "../lib/ledger.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

const sequences = Number(process.env.CHAOS_SEQUENCES ?? 3)

const length = Number(process.env.CHAOS_ACTIONS ?? 16)

const actions = [
  "send-shell",
  "send-shell",
  "send-text",
  "freeze-executor",
  "kill-executor",
  "replace-executor",
  "black-hole-executor",
  "ren-down",
  "short-token",
  "restart-cell",
  "cut-environment",
] as const

interface Sent {
  readonly messageId: Session.MessageID
  readonly marker: string | undefined
  readonly accepted: boolean
}

describe.skipIf(Platform.wrangler !== undefined)("seeded process, lifecycle and network faults (U2, U3)", () => {
  const lane: { stack?: Stack.Instance; environment?: Stack.Environment } = {}

  const current = () => {
    if (!lane.stack || !lane.environment) throw new Error("the stack did not start")
    return { stack: lane.stack, environment: lane.environment }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.environment = await lane.stack.environment("lifecycle-chaos")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  test.each(Array.from({ length: sequences }, (_, index) => Wait.seed + 100 + index))(
    `seed %i: ${length} faults end every turn, keep each message once and each effect at most once, and the session recovers`,
    async (seed) => {
      const stack = current().stack
      const environment = current().environment
      const random = Wait.random("lifecycle", seed)
      const access = () => stack.access(Stack.freshKey("lifecycle"), Date.now() + 4 * 60_000)
      stack.ren.refresh(() => ({ type: "grant", access: access() }))
      const session = await stack.session({ models: access(), environment })
      const healing: Array<Promise<void>> = []
      const later = (ms: number, heal: () => Promise<void> | void) =>
        // ast-grep-ignore: no-test-sleep -- the seeded duration of a fault is part of the sequence
        healing.push(Bun.sleep(ms).then(heal))
      const send = async (steps: ReadonlyArray<ModelProvider.Step>, marker: string | undefined): Promise<Sent> => {
        const messageId = Session.MessageID.create()
        const attempt = () =>
          session.turn(steps, marker ?? "lifecycle", { messageId }).then(
            () => true,
            () => false,
          )
        return { messageId, marker, accepted: (await attempt()) || (await attempt()) }
      }
      const shell = () => {
        const marker = Ledger.marker("lifecycle")
        return send([ModelProvider.tool("shell", { command: Ledger.append(marker) }), ModelProvider.text("ok")], marker)
      }
      const effects: Readonly<Record<(typeof actions)[number], () => Promise<Sent | void>>> = {
        "send-shell": shell,
        "send-text": () => send([ModelProvider.text("plain")], undefined),
        "freeze-executor": async () => {
          await environment.instance.freeze()
          later(random.integer(2_000, 12_000), () => environment.instance.thaw())
        },
        "kill-executor": () => environment.instance.restart(),
        "replace-executor": async () => {
          await environment.instance.replace()
          environment.retarget()
          environment.publish(environment.generation() + 1)
        },
        "black-hole-executor": async () => {
          environment.proxy.partition(true)
          later(random.integer(2_000, 10_000), () => environment.proxy.partition(false))
        },
        "ren-down": async () => {
          stack.renProxy.partition(true)
          later(random.integer(2_000, 10_000), () => stack.renProxy.partition(false))
        },
        "short-token": async () => {
          environment.publish(environment.generation(), 20_000)
        },
        "restart-cell": () => stack.restartCell(),
        "cut-environment": async () => void environment.proxy.cutAll(),
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
      await Promise.all(healing)
      await environment.instance.thaw()
      environment.proxy.partition(false)
      stack.renProxy.partition(false)
      environment.publish(environment.generation(), 3_600_000)
      await session.closed(240_000)
      const read = await session.messages()
      const accepted = sent.filter((entry) => entry.accepted)
      expect(accepted.map((entry) => SessionDriver.occurrences(read, entry.messageId))).toEqual(accepted.map(() => 1))
      const counts = await Promise.all(
        sent.flatMap((entry) => (entry.marker ? [Ledger.count(environment.instance, entry.marker)] : [])),
      )
      expect(counts.filter((count) => count > 1)).toEqual([])
      const recovered = Ledger.marker("recovered")
      // ast-grep-ignore: no-test-sleep -- a cell asks Ren again at most 30 seconds after Ren last failed
      await Bun.sleep(31_000)
      const turn = await session.turn(
        [ModelProvider.tool("shell", { command: Ledger.append(recovered) }), ModelProvider.text("ok")],
        "recover",
      )
      await turn.script.called(2, 60_000)
      await session.settled(60_000)
      expect(await Ledger.count(environment.instance, recovered)).toBe(1)
    },
    900_000,
  )
})
