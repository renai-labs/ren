import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { OpenCodeHost, Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Fiber, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

process.env["REN_TOKEN"] = "user-token"

const plugin = fileURLToPath(new URL("..", import.meta.url))

type Brain = Effect.Success<ReturnType<typeof BrainTest.make>>

const host = Effect.fnUntraced(function* (ren: Effect.Success<ReturnType<typeof RenServer.make>>) {
  const opened = yield* OpenCodeHost.make({ plugins: [{ package: plugin, options: { url: ren.url } }] })
  const delivered = yield* Queue.unbounded<string>()
  const connected = yield* Queue.unbounded<void>()
  yield* opened.client.event.subscribe({ types: ["session.inbox.delivered"] }).pipe(
    Stream.runForEach((event) =>
      event.type === "session.inbox.delivered"
        ? Queue.offer(delivered, event.data.inboxID)
        : Queue.offer(connected, undefined),
    ),
    Effect.forkScoped,
  )
  yield* Queue.take(connected)
  const wait = (sessionID: string) =>
    opened.client.experimental.session.wait({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
  const settled = (sessionID: string, id: string): Effect.Effect<void> =>
    Queue.take(delivered).pipe(Effect.flatMap((next) => (next === id ? wait(sessionID) : settled(sessionID, id))))
  const prompt = (sessionID: string, text: string) =>
    opened.client.session.prompt({ sessionID: Binding.LocalID.make(sessionID), text }).pipe(
      Effect.orDie,
      Effect.tap(() => wait(sessionID)),
    )
  const transcript = (sessionID: string) =>
    opened.client.session.context({ sessionID: Binding.LocalID.make(sessionID) }).pipe(
      Effect.orDie,
      Effect.map((messages) =>
        messages.flatMap((message) => {
          if (message.type === "user") return [`user:${message.text}`]
          if (message.type !== "assistant") return []
          return [message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")]
        }),
      ),
    )
  return { ...opened, settled, prompt, transcript }
})

const users = (brain: Brain) =>
  brain.chat.session["session.messages"]({ params: { sessionID: brain.id }, query: {} }).pipe(
    Effect.map((page) =>
      page.items
        .filter((message) => message.type === "user")
        .map((message) => String(message.id))
        .toSorted(),
    ),
  )

const setup = Effect.fnUntraced(function* () {
  const target: { brain?: Brain; member?: { readonly sub: string; readonly name: string } } = {}
  const ren = yield* RenServer.make({
    chat: (path, request) =>
      target.brain
        ? target.brain.chatFetch(path, request, target.member)
        : Promise.resolve(new Response(null, { status: 503 })),
    created: () => (target.brain ? Effect.runPromise(target.brain.start().pipe(Effect.asVoid)) : Promise.resolve()),
  })
  target.member = { sub: ren.state.me.id, name: ren.state.me.name }
  const ada = yield* host(ren)
  const created = yield* ada.client.rpc(RenRpc.Definition).createSession({}, { location: ada.location })
  const brain = yield* BrainTest.make({ id: Session.ID.make(created.sessionID) })
  target.brain = brain
  const bea = yield* brain.chatAs({ sub: ren.state.bea.id, name: ren.state.bea.name })
  return { ren, ada, sessionID: created.sessionID, brain, bea }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

test("a teammate's message sent through the brain's Chat API shows in the local session with their name and the Ren message ID, followed by the brain's answer, and the local reply is not mirrored back", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const first = Shared.stub().script({ reply: "Hello, Ada." })
      const sent = yield* opened.ada.prompt(opened.sessionID, first.marker)
      const asked = Shared.stub().script({ reply: "Lunch is at noon." })
      const id = SessionMessage.ID.create()
      yield* opened.bea.session["session.prompt"]({
        params: { sessionID: opened.brain.id },
        payload: { id, text: asked.marker, delivery: "steer" },
      })
      yield* opened.ada.settled(opened.sessionID, id)
      const local = yield* opened.ada.client.session
        .context({ sessionID: Binding.LocalID.make(opened.sessionID) })
        .pipe(Effect.orDie)
      expect(local.find((message) => String(message.id) === id)).toMatchObject({
        type: "user",
        text: `Bea: ${asked.marker}`,
        metadata: { userID: opened.ren.state.bea.id, userName: "Bea", remote: true },
      })
      expect(yield* opened.ada.transcript(opened.sessionID)).toEqual([
        `user:${first.marker}`,
        "Hello, Ada.",
        `user:Bea: ${asked.marker}`,
        "Lunch is at noon.",
      ])
      expect(yield* users(opened.brain)).toEqual([String(sent.id), id])

      const reply = Shared.stub().script({ reply: "Thanks." })
      const replied = yield* opened.ada.prompt(opened.sessionID, reply.marker)
      expect(yield* users(opened.brain)).toEqual([String(sent.id), id, String(replied.id)])
      expect(yield* opened.ada.transcript(opened.sessionID)).toEqual([
        `user:${first.marker}`,
        "Hello, Ada.",
        `user:Bea: ${asked.marker}`,
        "Lunch is at noon.",
        `user:${reply.marker}`,
        "Thanks.",
      ])
    }),
  ))

test("on a real brain, a teammate's steer during a local turn is answered in the same execution after the local step, and the local session shows it after the local answer with its own answer", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const held = Shared.stub().script({ reply: "Working on it.", hold: true })
      const sending = yield* opened.ada.prompt(opened.sessionID, held.marker).pipe(Effect.forkChild)
      yield* Effect.promise(() => held.called())
      const steer = Shared.stub().script({ reply: "Tests checked." })
      const id = SessionMessage.ID.create()
      yield* opened.bea.session["session.prompt"]({
        params: { sessionID: opened.brain.id },
        payload: { id, text: steer.marker, delivery: "steer" },
      })
      held.release()
      const sent = yield* Fiber.join(sending)
      yield* opened.ada.settled(opened.sessionID, id)
      expect(yield* opened.ada.transcript(opened.sessionID)).toEqual([
        `user:${held.marker}`,
        "Working on it.",
        `user:Bea: ${steer.marker}`,
        "Tests checked.",
      ])
      expect(yield* users(opened.brain)).toEqual([String(sent.id), id])
    }),
  ))

test("two teammates who both use the plugin on one Ren session each see the other's messages once", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const first = Shared.stub().script({ reply: "Hello, Ada." })
      const adaFirst = yield* opened.ada.prompt(opened.sessionID, first.marker)

      const other = yield* RenServer.make({
        chat: (path, request) =>
          opened.brain.chatFetch(path, request, { sub: opened.ren.state.bea.id, name: opened.ren.state.bea.name }),
      })
      other.state.me = opened.ren.state.bea
      other.state.members = opened.ren.state.members
      const bea = yield* host(other)
      yield* bea.client.session
        .create({
          location: bea.location,
          id: Binding.LocalID.make(opened.sessionID),
          model: { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") },
          metadata: { ren: { spaceId: other.state.spaceId, sessionId: opened.sessionID } },
        })
        .pipe(Effect.orDie)
      const second = Shared.stub().script({ reply: "Hello, Bea." })
      const beaFirst = yield* bea.prompt(opened.sessionID, second.marker)
      yield* opened.ada.settled(opened.sessionID, String(beaFirst.id))

      const third = Shared.stub().script({ reply: "Hello, both." })
      const adaSecond = yield* opened.ada.prompt(opened.sessionID, third.marker)
      yield* bea.settled(opened.sessionID, String(adaSecond.id))

      expect(yield* opened.ada.transcript(opened.sessionID)).toEqual([
        `user:${first.marker}`,
        "Hello, Ada.",
        `user:Bea: ${second.marker}`,
        "Hello, Bea.",
        `user:${third.marker}`,
        "Hello, both.",
      ])
      expect(yield* bea.transcript(opened.sessionID)).toEqual([
        `user:${second.marker}`,
        "Hello, Bea.",
        `user:Ada: ${third.marker}`,
        "Hello, both.",
      ])
      expect(yield* users(opened.brain)).toEqual([String(adaFirst.id), String(beaFirst.id), String(adaSecond.id)])
    }),
  ))
