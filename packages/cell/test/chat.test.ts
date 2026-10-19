import { expect, setDefaultTimeout, test } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { ChatApi } from "@ren/protocol/chat"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session-event"
import { SessionMessage } from "@ren/schema/session-message"
import { Effect, Exit, Fiber, Queue, type Scope, Stream } from "effect"
import { HttpApi } from "effect/http-api"
import { Chat } from "../src/chat.js"
import { BrainTest } from "./lib/brain.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(30_000)

const stub = Shared.stub()

const live = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const follow = Effect.fnUntraced(function* (brain: Effect.Success<ReturnType<typeof BrainTest.make>>) {
  const frames = yield* Queue.unbounded<SessionEvent.Frame>()
  const stream = yield* brain.chat.event["event.subscribe"]()
  const fiber = yield* stream.pipe(
    Stream.runForEach((frame) => Queue.offer(frames, frame)),
    Effect.ensuring(Queue.offer(frames, { id: "end", created: 0, type: "stream.ended", data: { reason: "closing" } })),
    Effect.forkScoped,
  )
  const until = (type: string): Effect.Effect<ReadonlyArray<SessionEvent.Frame>> =>
    Effect.gen(function* () {
      const seen: Array<SessionEvent.Frame> = []
      const next = (): Effect.Effect<ReadonlyArray<SessionEvent.Frame>> =>
        Queue.take(frames).pipe(
          Effect.flatMap((frame) => {
            seen.push(frame)
            if (frame.type === type) return Effect.succeed(seen)
            if (frame.type === "stream.ended") return Effect.die(new Error(`The stream ended before ${type}`))
            return next()
          }),
        )
      return yield* next()
    })
  return { until, fiber }
})

test("every Chat API path is under the prefix the worker opens to client tokens", () => {
  const paths: Array<string> = []
  HttpApi.reflect(ChatApi, { onGroup: () => {}, onEndpoint: (options) => paths.push(options.endpoint.path) })
  expect(paths.filter((path) => !Chat.owns(path))).toEqual([])
})

test("a prompt streams the turn as it happens, and the reads show the same turn with its sender", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const events = yield* follow(brain)
      yield* events.until("server.connected")
      const id = SessionMessage.ID.create()
      const params = { sessionID: brain.id }
      expect(
        yield* brain.chat.session["session.prompt"]({
          params,
          payload: { id, text: stub.script({ reply: "hello there world" }).marker, delivery: "steer" },
        }),
      ).toEqual({ id })
      const turn = yield* events.until("session.execution.succeeded")
      expect(turn.flatMap((frame) => (frame.type === "session.text.delta" ? [frame.data.delta] : [])).join("")).toBe(
        "hello there world",
      )
      const page = yield* brain.chat.session["session.messages"]({ params, query: {} })
      expect(page.items.map((message) => message.type)).toEqual(["idle", "assistant", "user"])
      expect(page.items[2]).toMatchObject({ id, sender: { userId: "user_1" } })
      expect(page.items[1]).toMatchObject({ content: [{ type: "text", text: "hello there world" }] })
      expect(yield* brain.chat.session["session.message"]({ params: { ...params, messageID: id } })).toMatchObject({
        id,
        sender: { userId: "user_1" },
      })
      expect(yield* brain.chat.session["session.get"]({ params })).toMatchObject({
        id: brain.id,
        capabilities: { steer: true, fork: false },
      })
      expect(yield* brain.chat.session["session.status"]()).toEqual({})
    }),
  ))

test("sending the same message id again sends nothing new", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const id = SessionMessage.ID.create()
      const params = { sessionID: brain.id }
      const payload = { id, text: stub.script().marker, delivery: "steer" as const }
      yield* brain.chat.session["session.prompt"]({ params, payload })
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      expect(yield* brain.chat.session["session.prompt"]({ params, payload })).toEqual({ id })
      const page = yield* brain.chat.session["session.messages"]({ params, query: {} })
      expect(page.items.filter((message) => message.type === "user")).toHaveLength(1)
    }),
  ))

test("a member switches the model from the list, an unknown model is refused, and Ren's unchanged model does not undo the switch", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start({ model: { endpointId: "stub", modelId: "stub-model" } })
      const params = { sessionID: brain.id }
      const models = yield* brain.chat.model["model.list"]()
      expect(models.map((model) => `${model.providerID}/${model.id}`)).toContain("stub/stub-other")
      const refused = yield* brain.chat.session["session.model.switch"]({
        params,
        payload: { model: { providerID: "stub", id: "missing" } },
      }).pipe(Effect.exit)
      expect(Exit.isFailure(refused) && refused.cause.toString()).toContain("InvalidRequestError")
      yield* brain.chat.session["session.model.switch"]({
        params,
        payload: { model: { providerID: "stub", id: "stub-other" } },
      })
      yield* brain.start({ model: { endpointId: "stub", modelId: "stub-model" } })
      const script = stub.script()
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: script.marker, delivery: "steer" },
      })
      expect((yield* Effect.promise(() => script.called())).body.model).toBe("stub-other")
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      yield* brain.start({ model: { endpointId: "stub", modelId: "stub-model", variant: "high" } })
      expect(yield* brain.chat.session["session.get"]({ params })).toMatchObject({
        model: { id: "stub-model", variant: "high" },
      })
    }),
  ))

test("a client answers a permission request and a question through the Chat API", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const events = yield* follow(brain)
      const params = { sessionID: brain.id }
      yield* brain.opencode.session.update({
        sessionID: SessionID.make(brain.id),
        permissions: [{ action: "webfetch", resource: "*", effect: "ask" }],
      })
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: {
          id: SessionMessage.ID.create(),
          delivery: "steer",
          text: stub.script({ tool: { name: "webfetch", input: { url: "https://example.com" } } }).marker,
        },
      })
      yield* events.until("permission.asked")
      const [request] = yield* brain.chat.session["session.permission.list"]({ params })
      if (!request) return yield* Effect.die(new Error("No permission request"))
      yield* brain.chat.session["session.permission.reply"]({
        params: { ...params, requestID: request.id },
        payload: { reply: "reject" },
      })
      yield* events.until("permission.replied")
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: {
          id: SessionMessage.ID.create(),
          delivery: "steer",
          text: stub.script({
            tool: {
              name: "question",
              input: {
                questions: [{ question: "Which?", header: "Pick", options: [{ label: "A", description: "a" }] }],
              },
            },
          }).marker,
        },
      })
      yield* events.until("form.created")
      const [form] = yield* brain.chat.session["session.form.list"]({ params })
      if (!form) return yield* Effect.die(new Error("No question"))
      const field = form.fields[0]
      yield* brain.chat.session["session.form.reply"]({
        params: { ...params, formID: form.id },
        payload: { answer: { [field.key]: "A" } },
      })
      yield* events.until("form.replied")
      const settled = yield* brain.chat.session["session.form.cancel"]({ params: { ...params, formID: form.id } }).pipe(
        Effect.exit,
      )
      expect(Exit.isFailure(settled)).toBe(true)
    }),
  ))

test("a client compacts the session through the Chat API and reads the summary", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const summarized = { summary: "## Objective\n- the summary" }
      yield* Effect.forEach(
        [stub.script(summarized), stub.script(summarized)],
        (script) =>
          brain.chat.session["session.prompt"]({
            params,
            payload: { id: SessionMessage.ID.create(), text: script.marker, delivery: "steer" },
          }).pipe(Effect.andThen(brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) }))),
        { discard: true },
      )
      const events = yield* follow(brain)
      yield* events.until("server.connected")
      const id = SessionMessage.ID.create()
      expect(yield* brain.chat.session["session.compact"]({ params, payload: { id } })).toMatchObject({
        id,
        sessionID: brain.id,
        type: "compaction",
      })
      yield* events.until("session.compaction.ended")
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const page = yield* brain.chat.session["session.messages"]({ params, query: {} })
      expect(page.items.find((message) => message.type === "compaction")).toMatchObject({
        status: "completed",
        summary: expect.stringContaining("the summary"),
      })
    }),
  ))

test("a session with no messages reads as an empty page", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      expect(
        yield* brain.chat.session["session.messages"]({ params: { sessionID: brain.id }, query: { limit: 20 } }),
      ).toEqual({ items: [], cursor: {} })
    }),
  ))

test("a session outside this brain is not found", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const missing = yield* brain.chat.session["session.get"]({ params: { sessionID: Session.ID.create() } }).pipe(
        Effect.exit,
      )
      expect(Exit.isFailure(missing) && missing.cause.toString()).toContain("NotFoundError")
    }),
  ))

test("the event stream ends once the session is idle, and not while a turn runs", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make({ vars: { CHAT_IDLE_MS: "300", CHAT_HEARTBEAT_MS: "50" } })
      yield* brain.start()
      const held = stub.script({ hold: true })
      yield* brain.chat.session["session.prompt"]({
        params: { sessionID: brain.id },
        payload: { id: SessionMessage.ID.create(), text: held.marker, delivery: "steer" },
      })
      yield* Effect.promise(() => held.called())
      const events = yield* follow(brain)
      const quiet = yield* events
        .until("server.heartbeat")
        .pipe(Effect.andThen(events.until("server.heartbeat")), Effect.repeat({ times: 8 }))
      expect(quiet.some((frame) => frame.type === "stream.ended")).toBe(false)
      held.release()
      const ended = yield* events.until("stream.ended")
      expect(ended.at(-1)).toMatchObject({ type: "stream.ended", data: { reason: "idle" } })
      yield* Fiber.join(events.fiber)
    }),
  ))
