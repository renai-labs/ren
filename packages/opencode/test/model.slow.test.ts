import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

test("a prompt in a local ren/<model> session runs on a real brain and its turn, with the tool the brain ran, lands in the local session", () =>
  Effect.gen(function* () {
    const target: { brain?: Effect.Success<ReturnType<typeof BrainTest.make>> } = {}
    const ren = yield* RenServer.make({
      chat: (path, request) =>
        target.brain ? target.brain.chatFetch(path, request) : Promise.resolve(new Response(null, { status: 503 })),
      created: () => (target.brain ? Effect.runPromise(target.brain.start().pipe(Effect.asVoid)) : Promise.resolve()),
    })
    const host = yield* OpenCodeHost.make({
      plugins: [
        { package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url, space: ren.state.spaceId } },
      ],
    })
    const session = yield* host.client.session
      .create({
        location: host.location,
        model: { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") },
      })
      .pipe(Effect.orDie)
    target.brain = yield* BrainTest.make({ id: Session.ID.make(session.id) })
    const script = Shared.stub().script({
      tool: { name: "execute", input: { code: "return 21 * 2", activity: "Doubling twenty-one" } },
      reply: "The answer is 42.",
    })
    const sent = yield* host.client.session.prompt({ sessionID: session.id, text: script.marker }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID: session.id }).pipe(Effect.orDie)

    expect(ren.state.created.map((created) => String(created.id))).toEqual([String(session.id)])
    const remote = yield* target.brain.chat.session["session.messages"]({
      params: { sessionID: target.brain.id },
      query: {},
    })
    expect(remote.items.filter((message) => message.type === "user").map((message) => String(message.id))).toEqual([
      String(sent.id),
    ])
    const local = yield* host.client.session.context({ sessionID: session.id }).pipe(Effect.orDie)
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
