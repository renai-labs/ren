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

test("a session whose space Ren reports stopped fails its turn, and /ren:retry's RPC starts it again and runs the message on a real brain", () =>
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
    const rpc = host.client.rpc(RenRpc.Definition)
    const at = { location: host.location }
    const created = yield* rpc.createSession({}, at)
    const sessionID = Binding.LocalID.make(created.sessionID)
    target.brain = yield* BrainTest.make({ id: Session.ID.make(sessionID) })
    ren.state.boot.set(sessionID, { status: "stopped" })
    const script = Shared.stub().script({ reply: "Back on the brain." })
    const sent = yield* host.client.session.prompt({ sessionID, text: script.marker }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
    expect(yield* rpc.sessionStatus({ sessionID }, at)).toMatchObject({ state: "stopped" })

    expect(yield* rpc.retry({ sessionID }, at)).toEqual({ outcome: "restarted_resent" })
    yield* host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
    expect(yield* rpc.sessionStatus({ sessionID }, at)).toMatchObject({ state: "ready", busy: false })

    expect(ren.state.retries.map((each) => each.sessionID)).toEqual([sessionID])
    const remote = yield* target.brain.chat.session["session.messages"]({
      params: { sessionID: target.brain.id },
      query: {},
    })
    expect(remote.items.filter((message) => message.type === "user").map((message) => String(message.id))).toEqual([
      String(sent.id),
    ])
    const local = yield* host.client.session.context({ sessionID }).pipe(Effect.orDie)
    expect(
      local.flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          : [],
      ),
    ).toEqual(["Back on the brain."])
  }).pipe(Effect.scoped, Effect.runPromise))
