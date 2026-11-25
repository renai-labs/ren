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

const open = Effect.fnUntraced(function* () {
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
  const brain = yield* BrainTest.make({ id: Session.ID.make(sessionID) })
  target.brain = brain
  const users = brain.chat.session["session.messages"]({ params: { sessionID: brain.id }, query: {} }).pipe(
    Effect.map((page) => page.items.flatMap((message) => (message.type === "user" ? [message] : []))),
  )
  return { ren, host, sessionID, brain, users }
})

test("an agent mention that the real brain lists reaches its stored message, and an unknown one is left out", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const script = Shared.stub().script({ reply: "Explored." })
    const text = `${script.marker} @explore @nobody look around`
    const start = text.indexOf("@explore")
    yield* opened.host.client.session
      .prompt({
        sessionID: opened.sessionID,
        text,
        agents: [
          { name: "explore", mention: { start, end: start + 8, text: "@explore" } },
          { name: "nobody", mention: { start: start + 9, end: start + 16, text: "@nobody" } },
        ],
      })
      .pipe(Effect.orDie)
    yield* opened.host.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
    expect((yield* opened.users).map((message) => ({ text: message.text, agents: message.agents }))).toEqual([
      { text, agents: [{ name: "explore", mention: { start, end: start + 8, text: "@explore" } }] },
    ])
  }).pipe(Effect.scoped, Effect.runPromise))

test("a file attachment is uploaded to the space's drive and sent by its path; a brain whose chat cannot read the drive refuses it, and the local turn fails with its reason", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const sent = yield* opened.host.client.session
      .prompt({
        sessionID: opened.sessionID,
        text: "read the plan",
        files: [{ uri: "data:text/plain;base64,c2hpcCBvbiBmcmlkYXk=", name: "plan.txt" }],
      })
      .pipe(Effect.orDie)
    yield* opened.host.client.experimental.session.wait({ sessionID: opened.sessionID }).pipe(Effect.orDie)
    expect(opened.ren.state.uploads.map((upload) => [upload.path, new TextDecoder().decode(upload.bytes)])).toEqual([
      [`chats/${opened.sessionID}/uploads/${sent.id}/plan.txt`, "ship on friday"],
    ])
    const local = yield* opened.host.client.session.context({ sessionID: opened.sessionID }).pipe(Effect.orDie)
    expect(
      local.flatMap((message) => (message.type === "assistant" && message.error ? [message.error.message] : [])),
    ).toEqual([expect.stringContaining("This chat cannot use the space’s drive")])
    expect(yield* opened.users).toEqual([])
  }).pipe(Effect.scoped, Effect.runPromise))
