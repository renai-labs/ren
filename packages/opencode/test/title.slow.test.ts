import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { Effect, Queue, Schema, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

test("on a real brain, a local rename reaches the brain's title, and a rename on the brain reaches the local title without coming back", () =>
  Effect.gen(function* () {
    const target: { brain?: Effect.Success<ReturnType<typeof BrainTest.make>> } = {}
    const renamed = yield* Queue.unbounded<string>()
    const ren = yield* RenServer.make({
      chat: async (path, request) => {
        if (!target.brain) return new Response(null, { status: 503 })
        const patch =
          request.method === "PATCH"
            ? Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String }))(await request.clone().json()).title
            : undefined
        const response = await target.brain.chatFetch(path, request)
        if (patch) Queue.offerUnsafe(renamed, patch)
        return response
      },
      created: () => (target.brain ? Effect.runPromise(target.brain.start().pipe(Effect.asVoid)) : Promise.resolve()),
    })
    const host = yield* OpenCodeHost.make({
      plugins: [{ package: fileURLToPath(new URL("..", import.meta.url)), options: { url: ren.url } }],
    })
    const titles = yield* Queue.unbounded<string>()
    const connected = yield* Queue.unbounded<void>()
    yield* host.client.event.subscribe({ types: ["session.renamed"] }).pipe(
      Stream.runForEach((event) =>
        event.type === "session.renamed" ? Queue.offer(titles, event.data.title) : Queue.offer(connected, undefined),
      ),
      Effect.forkScoped,
    )
    yield* Queue.take(connected)
    const created = yield* host.client.rpc(RenRpc.Definition).createSession({}, { location: host.location })
    const sessionID = Binding.LocalID.make(created.sessionID)
    const brain = yield* BrainTest.make({ id: Session.ID.make(sessionID) })
    target.brain = brain
    const script = Shared.stub().script({ reply: "Hello." })
    yield* host.client.session.prompt({ sessionID, text: script.marker }).pipe(Effect.orDie)
    yield* host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
    const brainTitle = brain.chat.session["session.get"]({ params: { sessionID: brain.id } }).pipe(
      Effect.map((info) => info.title),
    )
    const localTitle = host.client.session.get({ sessionID }).pipe(
      Effect.orDie,
      Effect.map((info) => info.title),
    )
    const until = (title: string): Effect.Effect<void> =>
      Queue.take(titles).pipe(Effect.flatMap((next) => (next === title ? Effect.void : until(title))))

    yield* host.client.session.update({ sessionID, title: "Named in OpenCode" }).pipe(Effect.orDie)
    expect(yield* Queue.take(renamed)).toBe("Named in OpenCode")
    expect(yield* brainTitle).toBe("Named in OpenCode")

    yield* brain.driver.rename(brain.id, "Named on the brain")
    yield* until("Named on the brain")
    expect(yield* localTitle).toBe("Named on the brain")

    yield* host.client.session.update({ sessionID, title: "Final" }).pipe(Effect.orDie)
    expect(yield* Queue.take(renamed)).toBe("Final")
    expect(yield* brainTitle).toBe("Final")
    expect(yield* Queue.size(renamed)).toBe(0)
  }).pipe(Effect.scoped, Effect.runPromise))
