import { expect, setDefaultTimeout, test } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { DateTime, Effect, Layer, Option, type Scope, Stream, SubscriptionRef } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChatSession } from "../src/chat-session.js"
import { ChatState } from "../src/chat-state.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

type Brain = Effect.Success<ReturnType<typeof BrainTest.make>>

const live = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const http = (brain: Brain) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        Object.assign(
          (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : String(input))
            return brain.chatFetch(`${url.pathname}${url.search}`, input instanceof Request ? input : (init ?? {}))
          },
          { preconnect: fetch.preconnect },
        ),
      ),
    ),
  )

const access = Effect.sync(() => ({
  url: "http://cell",
  token: "a-client-token",
  expiresAt: DateTime.makeUnsafe(Date.now() + 3_600_000),
}))

const open = (brain: Brain) =>
  ChatSession.make({ sessionID: brain.id, access, sender: { userId: "user_1" } }).pipe(Effect.provide(http(brain)))

const until = <A>(ref: SubscriptionRef.SubscriptionRef<A>, predicate: (value: A) => boolean) =>
  SubscriptionRef.changes(ref).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () => Effect.die(new Error("The chat state never reached the expected value")),
    }),
  )

const settled = (sessionID: string) => (state: ChatState.State) =>
  ChatState.activity(state, sessionID) === "idle" &&
  ChatState.messages(state, sessionID).some((message) => message.type === "assistant") &&
  ChatState.pending(state, sessionID).length === 0

const shape = (messages: ReadonlyArray<ChatState.State["messages"][string][number]>) =>
  messages.map((message) => ({
    id: message.id,
    type: message.type,
    ...(message.type === "user" && { text: message.text, sender: message.sender }),
    ...(message.type === "assistant" && {
      content: message.content.map((part) =>
        part.type === "tool" ? { type: part.type, name: part.name, status: part.state.status } : part.text,
      ),
    }),
  }))

test("a prompt shows at once, streams its turn, and the live transcript equals a fresh read", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* until(chat.status, (status) => status === "connected")
      const held = stub.script({
        hold: true,
        reasoning: "thinking it over",
        tool: { name: "skill", input: { name: "missing" } },
      })
      const id = yield* chat.prompt({ text: `plan ${held.marker}` })
      expect(ChatState.messages(yield* SubscriptionRef.get(chat.state), brain.id).at(-1)).toMatchObject({
        id,
        type: "user",
        sender: { userId: "user_1" },
      })
      yield* Effect.promise(() => held.called())
      held.release()
      const done = yield* until(chat.state, settled(brain.id))
      expect(shape(ChatState.messages(done, brain.id)).map((message) => message.type)).toEqual([
        "user",
        "assistant",
        "assistant",
        "idle",
      ])
      const fresh = yield* open(brain)
      yield* fresh.open(brain.id)
      const read = yield* SubscriptionRef.get(fresh.state)
      expect(shape(ChatState.messages(done, brain.id))).toEqual(shape(ChatState.messages(read, brain.id)))
    }),
  ))

test("a prompt that cannot be sent leaves no optimistic row behind", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      const chat = yield* ChatSession.make({
        sessionID: brain.id,
        access: Effect.fail(new Error("Ren is unreachable")),
        connection: { reconnectDelay: 60_000 },
      }).pipe(Effect.provide(http(brain)))
      const failed = yield* chat.prompt({ text: "hello" }).pipe(Effect.flip)
      expect(failed._tag).toBe("ChatSession.AccessFailed")
      expect(ChatState.messages(yield* SubscriptionRef.get(chat.state), brain.id)).toEqual([])
      expect((yield* SubscriptionRef.get(chat.state)).outbox.size).toBe(0)
    }),
  ))

test("the chat parks when the brain ends an idle stream, and a prompt wakes it", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make({ vars: { CHAT_IDLE_MS: "300", CHAT_HEARTBEAT_MS: "50" } })
      yield* brain.start()
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* until(chat.status, (status) => status === "parked")
      yield* chat.prompt({ text: stub.script({ reply: "awake again" }).marker })
      yield* until(chat.status, (status) => status === "connected")
      const done = yield* until(chat.state, settled(brain.id))
      expect(ChatState.messages(done, brain.id).find((message) => message.type === "assistant")).toMatchObject({
        content: [{ type: "text", text: "awake again" }],
      })
    }),
  ))

test("a permission request arrives live and leaves once the member answers it", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      yield* brain.opencode.session.update({
        sessionID: SessionID.make(brain.id),
        permissions: [{ action: "webfetch", resource: "*", effect: "ask" }],
      })
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* until(chat.status, (status) => status === "connected")
      yield* chat.prompt({
        text: stub.script({ tool: { name: "webfetch", input: { url: "https://example.com" } } }).marker,
      })
      const asked = yield* until(chat.state, (state) => (state.permissions[brain.id] ?? []).length > 0)
      const request = asked.permissions[brain.id]?.at(0)
      if (!request) return yield* Effect.die(new Error("No permission request"))
      yield* chat.replyPermission(brain.id, request.id, "reject")
      expect((yield* SubscriptionRef.get(chat.state)).permissions[brain.id]).toEqual([])
      yield* until(chat.state, settled(brain.id))
    }),
  ))

test("a rename reaches the chat after its session read, so a stale read cannot undo it", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const chat = yield* open(brain)
      yield* until(chat.status, (status) => status === "connected")
      yield* Effect.all([
        chat.open(brain.id),
        brain.opencode.session.update({ sessionID: SessionID.make(brain.id), title: "Renamed live" }),
      ])
      const renamed = yield* until(chat.state, (state) => state.info[brain.id]?.title === "Renamed live")
      expect(renamed.info[brain.id]?.title).toBe("Renamed live")
    }),
  ))
