import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

test("a session from /ren:new runs its first prompt on a real brain in the selected space, and the turn, with the tool the brain ran, lands in the local session", () =>
  Effect.gen(function* () {
    const target: { brain?: Effect.Success<ReturnType<typeof BrainTest.make>> } = {}
    const ren = yield* RenServer.make({
      chat: (path, request) =>
        target.brain ? target.brain.chatFetch(path, request) : Promise.resolve(new Response(null, { status: 503 })),
      created: () => (target.brain ? Effect.runPromise(target.brain.start().pipe(Effect.asVoid)) : Promise.resolve()),
    })
    const host = yield* OpenCodeHost.make({
      plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
    })
    const created = yield* host.client.rpc(RenRpc.Definition).createSession({}, { location: host.location })
    const sessionID = Binding.LocalID.make(created.sessionID)
    target.brain = yield* BrainTest.make({ id: Session.ID.make(sessionID) })
    const script = Shared.stub().script({
      tool: { name: "execute", input: { code: "return 21 * 2", activity: "Doubling twenty-one" } },
      reply: "The answer is 42.",
    })
    const sent = yield* host.client.session.prompt({ sessionID, text: script.marker }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)

    expect(ren.state.created).toEqual([
      { id: Session.ID.make(sessionID), spaceId: ren.state.spaceId, model: { providerID: "stub", id: "stub-model" } },
    ])
    const remote = yield* target.brain.chat.session["session.messages"]({
      params: { sessionID: target.brain.id },
      query: {},
    })
    expect(remote.items.filter((message) => message.type === "user").map((message) => String(message.id))).toEqual([
      String(sent.id),
    ])
    const local = yield* host.client.session.context({ sessionID }).pipe(Effect.orDie)
    const assistant = local.flatMap((message) => (message.type === "assistant" ? message.content : []))
    expect(assistant.flatMap((part) => (part.type === "text" ? [part.text] : []))).toEqual(["The answer is 42."])
    expect(assistant.find((part) => part.type === "tool")).toMatchObject({
      type: "tool",
      name: "execute",
      executed: true,
      state: { status: "completed", input: { code: "return 21 * 2" } },
    })
    expect(local.flatMap((message) => (message.type === "assistant" && message.error ? [message.error] : []))).toEqual(
      [],
    )
  }).pipe(Effect.scoped, Effect.runPromise))
