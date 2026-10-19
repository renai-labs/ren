import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@ren/schema/session-message"
import { Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import { DateTime, Effect, Layer, Option, type Scope, Stream, SubscriptionRef } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChatSession } from "../src/chat-session.js"
import { ChatState } from "../src/chat-state.js"
import { Family } from "../src/family.js"
import { Fixture } from "./lib/fixture.js"

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

test("auto-approve answers a live request once, and one asked before it was enabled", () =>
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
      const fetch = { tool: { name: "webfetch", input: { url: "https://example.com" } } }
      yield* chat.prompt({ text: stub.script(fetch).marker })
      yield* until(chat.state, (state) => (state.permissions[brain.id] ?? []).length > 0)
      yield* SubscriptionRef.set(chat.autoApprove, true)
      yield* until(chat.state, settled(brain.id))
      yield* chat.prompt({ text: stub.script(fetch).marker })
      const done = yield* until(
        chat.state,
        (state) =>
          settled(brain.id)(state) &&
          ChatState.messages(state, brain.id).filter((message) => message.type === "idle").length === 2,
      )
      expect(done.permissions[brain.id]).toEqual([])
      const tools = ChatState.messages(done, brain.id).flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "tool" ? [part.state] : []))
          : [],
      )
      expect(tools).toHaveLength(2)
      expect(
        tools.filter((tool) => tool.status === "error" && tool.error.message.toLowerCase().includes("reject")),
      ).toEqual([])
    }),
  ))

test("coalesces duplicate gestures until the admission request settles", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* until(chat.status, (status) => status === "connected")
      const summarized = { summary: "## Objective\n- the summary" }
      yield* chat.prompt({ text: stub.script(summarized).marker })
      yield* until(chat.state, settled(brain.id))
      yield* chat.prompt({ text: stub.script(summarized).marker })
      yield* until(chat.state, (state) => settled(brain.id)(state) && ChatState.messages(state, brain.id).length >= 6)
      const reply = stub.script({ reply: "after the summary" })
      const results = yield* Effect.all([chat.compact(), chat.compact(), chat.prompt({ text: reply.marker })], {
        concurrency: "unbounded",
      })
      expect(results[0]).toBe(results[1])
      const done = yield* until(
        chat.state,
        (state) =>
          settled(brain.id)(state) &&
          ChatState.messages(state, brain.id).some(
            (message) => message.type === "compaction" && message.status === "completed",
          ) &&
          ChatState.messages(state, brain.id).some(
            (message) =>
              message.type === "assistant" &&
              message.content.some((part) => part.type === "text" && part.text === "after the summary"),
          ),
      )
      expect(ChatState.messages(done, brain.id).filter((message) => message.type === "compaction")).toHaveLength(1)
      expect(done.compacting).toEqual({})
      expect(done.outbox.size).toBe(0)
    }),
  ))

test("bulk history (join)", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const writer = yield* open(brain)
      yield* writer.open(brain.id)
      yield* until(writer.status, (status) => status === "connected")
      yield* Effect.forEach(
        ["first", "second"],
        (reply) =>
          writer
            .prompt({ text: stub.script({ reply }).marker })
            .pipe(
              Effect.andThen(
                until(writer.state, (state) =>
                  ChatState.messages(state, brain.id).some(
                    (message) =>
                      message.type === "assistant" &&
                      message.content.some((part) => part.type === "text" && part.text === reply),
                  ),
                ),
              ),
              Effect.andThen(until(writer.state, settled(brain.id))),
            ),
        { discard: true },
      )
      const full = ChatState.messages(yield* SubscriptionRef.get(writer.state), brain.id).map((message) => message.id)
      const reader = yield* ChatSession.make({ sessionID: brain.id, access, initialMessageLimit: 2 }).pipe(
        Effect.provide(http(brain)),
      )
      yield* reader.open(brain.id)
      expect(ChatState.more(yield* SubscriptionRef.get(reader.state), brain.id)).toBe(true)
      yield* Effect.all([reader.loadMore(brain.id), reader.loadMore(brain.id), reader.loadMore(brain.id, true)], {
        concurrency: "unbounded",
      })
      const loaded = yield* SubscriptionRef.get(reader.state)
      expect(ChatState.messages(loaded, brain.id).map((message) => message.id)).toEqual(full)
      expect(ChatState.more(loaded, brain.id)).toBe(false)
      expect(ChatState.loadingHistory(loaded, brain.id)).toBe(false)
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

const answered = (state: ChatState.State, sessionID: string, text: string) =>
  ChatState.messages(state, sessionID).some(
    (message) =>
      message.type === "assistant" && message.content.some((part) => part.type === "text" && part.text === text),
  )

const turn = (chat: ChatSession.ChatSession, reply: string) =>
  chat
    .prompt({ text: stub.script({ reply }).marker })
    .pipe(
      Effect.tap(() =>
        until(chat.state, (state) => settled(chat.sessionID)(state) && answered(state, chat.sessionID, reply)),
      ),
    )

const userIDs = (state: ChatState.State, sessionID: string) =>
  ChatState.userMessages(state, sessionID).map((message): string => message.id)

test("undo hides the last turn, redo brings it back, and the next prompt commits the revert", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* until(chat.status, (status) => status === "connected")
      const first = yield* turn(chat, "first")
      const second = yield* turn(chat, "second")
      expect(Option.map(yield* chat.undo, (message): string => message.id)).toEqual(Option.some(second))
      const staged = yield* SubscriptionRef.get(chat.state)
      expect(ChatState.revertMessageID(staged, brain.id)).toBe(second)
      expect(ChatState.visible(staged, brain.id).some((message) => message.id >= second)).toBe(false)
      yield* chat.redo
      expect(ChatState.revertMessageID(yield* SubscriptionRef.get(chat.state), brain.id)).toBeUndefined()
      yield* chat.undo
      const third = yield* turn(chat, "third")
      const done = yield* SubscriptionRef.get(chat.state)
      expect(ChatState.revertMessageID(done, brain.id)).toBeUndefined()
      expect(userIDs(done, brain.id)).toEqual([first, third])
      const fresh = yield* open(brain)
      yield* fresh.open(brain.id)
      expect(shape(ChatState.messages(yield* SubscriptionRef.get(fresh.state), brain.id))).toEqual(
        shape(ChatState.messages(done, brain.id)),
      )
    }),
  ))

test("reverting an undelivered prompt withdraws it from the inbox and leaves the running turn alone", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* until(chat.status, (status) => status === "connected")
      const held = stub.script({ hold: true })
      yield* chat.prompt({ text: held.marker })
      yield* Effect.promise(() => held.called())
      yield* until(chat.state, (state) => ChatState.activity(state, brain.id) === "running")
      const queued = yield* chat.prompt({ text: stub.script().marker, delivery: "queue" })
      expect(Option.map(yield* chat.revert(queued), (message): string => message.id)).toEqual(Option.some(queued))
      const withdrawn = yield* SubscriptionRef.get(chat.state)
      expect(ChatState.pending(withdrawn, brain.id)).toEqual([])
      expect(userIDs(withdrawn, brain.id)).not.toContain(queued)
      expect(ChatState.activity(withdrawn, brain.id)).toBe("running")
      held.release()
      const done = yield* until(chat.state, settled(brain.id))
      expect(ChatState.revertMessageID(done, brain.id)).toBeUndefined()
      expect(userIDs(done, brain.id)).not.toContain(queued)
    }),
  ))

test("a rename shows at once and reaches the session", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* chat.rename("  Release notes  ")
      expect((yield* SubscriptionRef.get(chat.state)).info[brain.id]?.title).toBe("Release notes")
      expect(yield* brain.chat.session["session.get"]({ params: { sessionID: brain.id } })).toMatchObject({
        title: "Release notes",
      })
    }),
  ))

test("a link to an older message loads pages until the message is in the transcript", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const writer = yield* open(brain)
      yield* writer.open(brain.id)
      yield* until(writer.status, (status) => status === "connected")
      const first = yield* turn(writer, "first")
      yield* turn(writer, "second")
      yield* turn(writer, "third")
      const reader = yield* ChatSession.make({ sessionID: brain.id, access, initialMessageLimit: 2 }).pipe(
        Effect.provide(http(brain)),
      )
      yield* reader.open(brain.id)
      expect(userIDs(yield* SubscriptionRef.get(reader.state), brain.id)).not.toContain(first)
      expect(yield* reader.reveal(brain.id, first)).toBe(true)
      const revealed = yield* SubscriptionRef.get(reader.state)
      expect(userIDs(revealed, brain.id)).toContain(first)
      expect(yield* reader.reveal(brain.id, SessionMessage.ID.create())).toBe(false)
      expect(ChatState.more(yield* SubscriptionRef.get(reader.state), brain.id)).toBe(false)
    }),
  ))

test("a subagent's session, transcript and title read through the root session", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const chat = yield* open(brain)
      yield* chat.open(brain.id)
      yield* until(chat.status, (status) => status === "connected")
      const child = stub.script({ reply: "child answer" })
      yield* chat.prompt({
        text: stub.script({
          tool: { name: "subagent", input: { agent: "general", description: "Look around", prompt: child.marker } },
        }).marker,
      })
      const spawned = yield* until(chat.state, (state) =>
        Object.values(state.info).some((info) => info.parentID === brain.id),
      )
      const childID = Object.values(spawned.info).find((info) => info.parentID === brain.id)?.id
      if (!childID) return yield* Effect.die(new Error("No subagent session"))
      expect(Family.tree(spawned, brain.id)).toEqual([brain.id, childID])
      yield* chat.open(childID)
      const done = yield* until(chat.state, (state) => answered(state, childID, "child answer"))
      expect(Family.ancestors(done, childID)).toEqual([brain.id])
      yield* until(chat.state, settled(brain.id))
      expect(Family.childTitle(yield* SubscriptionRef.get(chat.state), childID, "Session")).toBe("Look around")
    }),
  ))

describe("timeline model", () => {
  const user = (id: string) => Fixture.user(id, 1)
  const assistant = (id: string) =>
    Fixture.message({ id, type: "assistant", agent: "build", model: Fixture.model, content: [], time: { created: 1 } })

  test.each([
    ["caps background pages when the parent remains outside the window", [assistant("msg_latest")], 3],
    ["does not load before a leading user turn", [user("msg_user"), assistant("msg_latest")], 0],
    ["does not load without an assistant turn", [user("msg_user")], 0],
  ] as const)("%s", (_name, messages, expected) =>
    Effect.gen(function* () {
      const loads = { count: 0 }
      yield* ChatSession.enrichLeadingTurn({
        messages: Effect.succeed(messages),
        more: Effect.succeed(true),
        loading: Effect.succeed(false),
        loadMore: Effect.sync(() => {
          loads.count += 1
        }),
        pause: Effect.void,
        maxPages: 3,
      })
      expect(loads.count).toBe(expected)
    }).pipe(Effect.runPromise),
  )

  test("pauses between history pages and stops once the leading turn has its parent", () =>
    Effect.gen(function* () {
      const pages = [[assistant("msg_older")], [user("msg_parent")], [user("msg_earlier")]]
      const messages = { current: [assistant("msg_latest"), user("msg_next")] }
      const calls: Array<string> = []
      yield* ChatSession.enrichLeadingTurn({
        messages: Effect.sync(() => messages.current),
        more: Effect.sync(() => pages.length > 0),
        loading: Effect.succeed(false),
        loadMore: Effect.sync(() => {
          const page = pages.shift() ?? []
          messages.current = [...page, ...messages.current]
          calls.push(`load:${page[0]?.id}`)
        }),
        pause: Effect.sync(() => {
          calls.push("pause")
        }),
        maxPages: 3,
      })
      expect(calls).toEqual(["pause", "load:msg_older", "pause", "load:msg_parent"])
      expect(pages).toHaveLength(1)
    }).pipe(Effect.runPromise))
})
