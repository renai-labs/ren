import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

const setup = Effect.fnUntraced(function* () {
  const target: { brain?: Effect.Success<ReturnType<typeof BrainTest.make>> } = {}
  const compactions: Array<unknown> = []
  const ren = yield* RenServer.make({
    chat: async (path, request) => {
      if (path.endsWith("/compact")) compactions.push(await request.clone().json())
      return target.brain ? target.brain.chatFetch(path, request) : new Response(null, { status: 503 })
    },
    created: () => (target.brain ? Effect.runPromise(target.brain.start().pipe(Effect.asVoid)) : Promise.resolve()),
  })
  ren.state.models.set(ren.state.spaceId, {
    models: [
      { id: "stub-model", providerID: "stub", name: "Stub", variants: [{ id: "high" }] },
      { id: "stub-other", providerID: "stub", name: "Stub Other", variants: [] },
    ],
  })
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
  })
  const created = yield* host.client.rpc(RenRpc.Definition).createSession({}, { location: host.location })
  const sessionID = Binding.LocalID.make(created.sessionID)
  const brain = yield* BrainTest.make({ id: Session.ID.make(sessionID) })
  target.brain = brain
  const prompt = (text: string) =>
    host.client.session.prompt({ sessionID, text }).pipe(
      Effect.orDie,
      Effect.tap(() => host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)),
    )
  const transcript = host.client.session.context({ sessionID }).pipe(
    Effect.orDie,
    Effect.map((messages) =>
      messages.flatMap((message) => {
        if (message.type === "user") return [`user:${message.text}`]
        if (message.type === "compaction") return [`compaction:${message.status}`]
        if (message.type !== "assistant") return []
        return [
          message.error
            ? `error:${message.error.message}`
            : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        ]
      }),
    ),
  )
  return { ren, host, sessionID, brain, prompt, transcript, compactions }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

test("on a real brain, a ren model picked in OpenCode is the model of the Ren session's next turn", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const first = Shared.stub().script({ reply: "On the first model." })
      yield* opened.prompt(first.marker)
      yield* opened.host.client.session
        .switchModel({
          sessionID: opened.sessionID,
          model: { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-other") },
        })
        .pipe(Effect.orDie)
      const second = Shared.stub().script({ reply: "On the other model." })
      yield* opened.prompt(second.marker)
      const remote = yield* opened.brain.chat.session["session.get"]({ params: { sessionID: opened.brain.id } })
      expect(remote.model).toEqual({ providerID: "stub", id: "stub-other", variant: "default" })
      expect(first.calls.map((call) => call.body.model)).toEqual(["stub-model"])
      expect(second.calls.map((call) => call.body.model)).toEqual(["stub-other"])
      expect(yield* opened.transcript).toEqual([
        `user:${first.marker}`,
        "On the first model.",
        `user:${second.marker}`,
        "On the other model.",
      ])
    }),
  ))

test("on a real brain, /compact compacts the Ren session, the local session keeps the brain's summary, and the next prompt still runs on the brain", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const first = Shared.stub().script({ reply: "Noted.", summary: "## Objective\n- the brain's summary" })
      yield* opened.prompt(first.marker)
      yield* opened.host.client.session.compact({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      yield* opened.host.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      const local = yield* opened.host.client.session.context({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      expect(local.find((message) => message.type === "compaction")).toMatchObject({
        status: "completed",
        summary: expect.stringContaining("the brain's summary"),
      })
      const remote = yield* opened.brain.chat.session["session.messages"]({
        params: { sessionID: opened.brain.id },
        query: {},
      })
      expect(remote.items.filter((message) => message.type === "compaction")).toMatchObject([
        { status: "completed", summary: expect.stringContaining("the brain's summary") },
      ])
      expect(opened.compactions).toEqual([{ id: remote.items.find((message) => message.type === "compaction")?.id }])
      const after = Shared.stub().script({ reply: "Still here." })
      yield* opened.prompt(after.marker)
      expect(yield* opened.transcript).toEqual(["compaction:completed", `user:${after.marker}`, "Still here."])
    }),
  ))
