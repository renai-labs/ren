import { expect, setDefaultTimeout, test } from "bun:test"
import { SessionID } from "@opencode/schema/session-id"
import { testEffect } from "@ren/executor/testing"
import { ChatApi } from "@ren/protocol/chat"
import { Session } from "@ren/schema/session"
import { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionEvent } from "@ren/schema/session/event"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Exit, Layer, Logger, Queue, Ref, type Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpApi } from "effect/http-api"
import { Chat } from "../src/chat.js"
import { BrainTest } from "./lib/brain.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(30_000)

const stub = Shared.stub()

const it = testEffect(Layer.empty)

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
        capabilities: { steer: true, revert: true, rename: true, compact: true },
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

test("the model learns who speaks when another member sends a message, and the transcript keeps what each typed", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const ada = yield* brain.chatAs({ sub: "user_1", name: "Ada (ada@example.com)" })
      const grace = yield* brain.chatAs({ sub: "user_2", name: "Grace Hopper" })
      const turns = [
        { chat: ada, note: "" },
        { chat: grace, note: '\n\n<message_from user="Grace Hopper" user_id="user_2" />' },
        { chat: grace, note: "" },
        { chat: ada, note: '\n\n<message_from user="Ada (ada@example.com)" user_id="user_1" />' },
      ]
      const typed = yield* Effect.forEach(turns, (turn) =>
        Effect.gen(function* () {
          const script = stub.script()
          const text = `hello ${script.marker}`
          yield* turn.chat.session["session.prompt"]({
            params,
            payload: { id: SessionMessage.ID.create(), text, delivery: "steer" },
          })
          expect((yield* Effect.promise(() => script.called())).text).toBe(`${text}${turn.note}`)
          yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
          return text
        }),
      )
      const page = yield* brain.chat.session["session.messages"]({ params, query: {} })
      expect(
        page.items.flatMap((message) => (message.type === "user" ? [[message.text, message.sender?.userId]] : [])),
      ).toEqual([
        [typed[3], "user_1"],
        [typed[2], "user_2"],
        [typed[1], "user_2"],
        [typed[0], "user_1"],
      ])
    }),
  ))

test("the model sees where a channel message came from above its text on every call, and the transcript keeps the typed text", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const channel = {
        provider: "github" as const,
        place: "acme/api",
        threadUrl: "https://github.com/acme/api/issues/12",
        sender: "octocat",
        handle: "octocat",
        context: "Issue #12 “The deploy fails”, open",
      }
      const first = stub.script()
      const text = `@ren-test look ${first.marker}`
      yield* brain.send(text, { channel })
      const header =
        "GitHub acme/api · @octocat · https://github.com/acme/api/issues/12\nIssue #12 “The deploy fails”, open\nText in this chat is not posted on GitHub. Act on the issue or pull request yourself with gh: comment, review or push.\n---\n\n"
      expect((yield* Effect.promise(() => first.called())).text).toBe(`${header}${text}`)
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const second = stub.script()
      yield* brain.send(`and then ${second.marker}`)
      const call = yield* Effect.promise(() => second.called())
      expect(call.text).toBe(`and then ${second.marker}`)
      expect(JSON.stringify(call.body.messages)).toContain(JSON.stringify(`${header}${text}`))
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const page = yield* brain.chat.session["session.messages"]({ params: { sessionID: brain.id }, query: {} })
      expect(
        page.items.flatMap((message) => (message.type === "user" ? [[message.text, message.channel]] : [])),
      ).toEqual([
        [`and then ${second.marker}`, undefined],
        [text, channel],
      ])
    }),
  ))

test("a prompt sent with resume false waits in the inbox of an idle session until another prompt starts the turn", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const waiting = SessionMessage.ID.create()
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: waiting, text: "first, in order", delivery: "queue", resume: false },
      })
      expect(yield* brain.chat.session["session.inbox.list"]({ params })).toMatchObject([
        { id: waiting, delivery: "queue" },
      ])
      expect(yield* brain.chat.session["session.status"]()).toEqual({})
      const script = stub.script()
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: script.marker, delivery: "steer" },
      })
      yield* Effect.promise(() => script.called())
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    }),
  ))

test("a client lists the web search providers where the session works", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const providers = yield* brain.chat.websearch["websearch.providers"]({ params: { sessionID: brain.id } })
      expect(providers.map((provider) => provider.id)).toContain("exa")
      const outside = yield* brain.chat.websearch["websearch.providers"]({
        params: { sessionID: Session.ID.create() },
      }).pipe(Effect.flip)
      expect(outside._tag).toBe("NotFoundError")
    }),
  ))

test("a member's queued message names its speaker to the model after the member withdraws the one before it", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const ada = yield* brain.chatAs({ sub: "user_1", name: "Ada" })
      const grace = yield* brain.chatAs({ sub: "user_2", name: "Grace" })
      const held = stub.script({ hold: true })
      yield* ada.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: held.marker, delivery: "steer" },
      })
      yield* Effect.promise(() => held.called())
      const withdrawn = SessionMessage.ID.create()
      yield* grace.session["session.prompt"]({
        params,
        payload: { id: withdrawn, text: "never mind", delivery: "queue" },
      })
      const kept = stub.script()
      yield* grace.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: kept.marker, delivery: "queue" },
      })
      yield* grace.session["session.inbox.cancel"]({ params: { ...params, inboxID: withdrawn } })
      held.release()
      expect((yield* Effect.promise(() => kept.called())).text).toBe(
        `${kept.marker}\n\n<message_from user="Grace" user_id="user_2" />`,
      )
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
    }),
  ))

test.todo("a command another member runs names its speaker to the model, and the transcript shows who ran it", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const ada = yield* brain.chatAs({ sub: "user_1", name: "Ada" })
      const grace = yield* brain.chatAs({ sub: "user_2", name: "Grace" })
      yield* ada.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: stub.script().marker, delivery: "steer" },
      })
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const reviewed = stub.script()
      yield* grace.session["session.command"]({
        params,
        payload: { name: "review", text: reviewed.marker, delivery: "steer" },
      })
      expect((yield* Effect.promise(() => reviewed.called())).text).toEndWith(
        '\n\n<message_from user="Grace" user_id="user_2" />',
      )
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const page = yield* brain.chat.session["session.messages"]({ params, query: {} })
      expect(page.items.find((message) => message.type === "user")).toMatchObject({ sender: { userId: "user_2" } })
    }),
  ),
)

test("a member switches the model from the list as the session's setting, an unknown model or a subagent's switch is refused, and Ren's unchanged model does not undo the switch", () =>
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
      const subagent = yield* brain.opencode.session.create({
        id: SessionID.make(`${brain.id}_child`),
        parentID: SessionID.make(brain.id),
      })
      const child = yield* brain.chat.session["session.model.switch"]({
        params: { sessionID: Session.ID.make(subagent.id) },
        payload: { model: { providerID: "stub", id: "stub-other" } },
      }).pipe(Effect.flip)
      expect(child._tag).toBe("InvalidRequestError")
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

test("a client answers a permission request, a rejection tells the session what to do instead, and a client answers a question", () =>
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
      const fetched = stub.script({ tool: { name: "webfetch", input: { url: "https://example.com" } } })
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), delivery: "steer", text: fetched.marker },
      })
      yield* events.until("permission.asked")
      const [request] = yield* brain.chat.session["session.permission.list"]({ params })
      if (!request) return yield* Effect.die(new Error("No permission request"))
      yield* brain.chat.session["session.permission.reply"]({
        params: { ...params, requestID: request.id },
        payload: { reply: "reject", message: "Read the cached copy instead" },
      })
      yield* events.until("permission.replied")
      expect(JSON.stringify((yield* Effect.promise(() => fetched.called(2))).body)).toContain(
        "Read the cached copy instead",
      )
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
      const asked = yield* events.until("form.created")
      expect(asked.at(-1)).toMatchObject({ data: { form: { kind: "question" } } })
      const [form] = yield* brain.chat.session["session.form.list"]({ params })
      if (!form) return yield* Effect.die(new Error("No question"))
      expect(form.kind).toBe("question")
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

test("a client compacts the session through the Chat API and reads the summary; the summarizer sees where a channel message came from", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const summarized = { summary: "## Objective\n- the summary" }
      const fromGitHub = stub.script(summarized)
      yield* brain.send(fromGitHub.marker, {
        channel: { provider: "github", place: "acme/api", sender: "octocat", handle: "octocat" },
      })
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const script = stub.script(summarized)
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: script.marker, delivery: "steer" },
      })
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
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
      const summarizer = stub.calls.find((call) => call.kind === "compaction" && call.marker === fromGitHub.marker)
      expect(JSON.stringify(summarizer?.body.messages)).toContain(
        JSON.stringify(
          `GitHub acme/api · @octocat\nText in this chat is not posted on GitHub. Act on the issue or pull request yourself with gh: comment, review or push.\n---\n\n${fromGitHub.marker}`,
        ),
      )
    }),
  ))

test("a client renames the session through the Chat API", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const events = yield* follow(brain)
      yield* events.until("server.connected")
      const params = { sessionID: brain.id }
      yield* brain.chat.session["session.rename"]({ params, payload: { title: "Release notes" } })
      const renamed = yield* events.until("session.renamed")
      expect(renamed.at(-1)).toMatchObject({ data: { sessionID: brain.id, title: "Release notes" } })
      expect(yield* brain.chat.session["session.get"]({ params })).toMatchObject({ title: "Release notes" })
      const blank = yield* brain.chat.session["session.rename"]({ params, payload: { title: " " } }).pipe(Effect.exit)
      expect(Exit.isFailure(blank)).toBe(true)
    }),
  ))

test("a revert stops the running turn, redo brings the messages back, and a commit drops them", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const first = SessionMessage.ID.create()
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: first, text: stub.script({ reply: "first answer" }).marker, delivery: "steer" },
      })
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const held = stub.script({ hold: true })
      const second = SessionMessage.ID.create()
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: second, text: held.marker, delivery: "steer" },
      })
      yield* Effect.promise(() => held.called())
      const events = yield* follow(brain)
      yield* events.until("server.connected")
      expect(
        yield* brain.chat.session["session.revert.stage"]({ params, payload: { messageID: second } }),
      ).toMatchObject({ messageID: second })
      held.release()
      const staged = yield* events.until("session.revert.staged")
      expect(staged.some((frame) => frame.type === "session.execution.interrupted")).toBe(true)
      expect(yield* brain.chat.session["session.get"]({ params })).toMatchObject({ revert: { messageID: second } })
      yield* brain.chat.session["session.revert.clear"]({ params })
      yield* events.until("session.revert.cleared")
      expect((yield* brain.chat.session["session.get"]({ params })).revert).toBeUndefined()
      yield* brain.chat.session["session.revert.stage"]({ params, payload: { messageID: second } })
      yield* brain.chat.session["session.revert.commit"]({ params })
      const committed = yield* events.until("session.revert.committed")
      expect(committed.at(-1)).toMatchObject({ data: { sessionID: brain.id, to: second } })
      const page = yield* brain.chat.session["session.messages"]({ params, query: {} })
      expect(page.items.some((message) => message.id === second)).toBe(false)
      expect(page.items.some((message) => message.id === first)).toBe(true)
    }),
  ))

test("a client withdraws queued input, and a stop with resume goes on with the steered input", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const held = stub.script({ hold: true })
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: held.marker, delivery: "steer" },
      })
      yield* Effect.promise(() => held.called())
      const queued = SessionMessage.ID.create()
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: queued, text: stub.script().marker, delivery: "queue" },
      })
      yield* brain.chat.session["session.inbox.cancel"]({ params: { ...params, inboxID: queued } })
      expect(yield* brain.chat.session["session.inbox.list"]({ params })).toEqual([])
      const steered = stub.script({ reply: "after the stop" })
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: steered.marker, delivery: "steer" },
      })
      yield* brain.chat.session["session.interrupt"]({ params, query: { resume: true } })
      held.release()
      yield* Effect.promise(() => steered.called())
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const page = yield* brain.chat.session["session.messages"]({ params, query: {} })
      expect(page.items.some((message) => message.id === queued)).toBe(false)
      expect(page.items.find((message) => message.type === "assistant")).toMatchObject({
        content: [{ type: "text", text: "after the stop" }],
      })
    }),
  ))

test("a client steers queued input into the running turn and queues it back, and input the session took cannot change or be withdrawn", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const params = { sessionID: brain.id }
      const held = stub.script({ hold: true })
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: SessionMessage.ID.create(), text: held.marker, delivery: "steer" },
      })
      yield* Effect.promise(() => held.called())
      const queued = SessionMessage.ID.create()
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: { id: queued, text: stub.script().marker, delivery: "queue" },
      })
      const inbox = { ...params, inboxID: queued }
      yield* brain.chat.session["session.inbox.update"]({ params: inbox, payload: { delivery: "steer" } })
      expect(yield* brain.chat.session["session.inbox.list"]({ params })).toMatchObject([
        { id: queued, delivery: "steer" },
      ])
      yield* brain.chat.session["session.inbox.update"]({ params: inbox, payload: { delivery: "queue" } })
      expect(yield* brain.chat.session["session.inbox.list"]({ params })).toMatchObject([
        { id: queued, delivery: "queue" },
      ])
      held.release()
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      const changed = yield* brain.chat.session["session.inbox.update"]({
        params: inbox,
        payload: { delivery: "steer" },
      }).pipe(Effect.flip)
      expect(changed._tag).toBe("ConflictError")
      expect((yield* brain.chat.session["session.inbox.cancel"]({ params: inbox }).pipe(Effect.flip))._tag).toBe(
        "ConflictError",
      )
      expect(yield* brain.chat.session["session.message"]({ params: { ...params, messageID: queued } })).toMatchObject({
        id: queued,
        type: "user",
      })
    }),
  ))

test("a client lists the agents, skills and commands where the session works, finds its files, mentions them and runs a command", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      yield* Effect.promise(() => Bun.write(`${brain.directory}/notes/release-plan.md`, "# Plan"))
      const params = { sessionID: brain.id }
      const agents = yield* brain.chat.agent["agent.list"]({ params })
      expect(SessionCatalog.mentionable(agents).map((agent) => agent.id)).toEqual(["general", "explore"])
      expect((yield* brain.chat.skill["skill.list"]({ params })).map((skill) => skill.id)).toContain("opencode")
      expect((yield* brain.chat.command["command.list"]({ params })).map((command) => command.name)).toContain("review")
      expect(yield* brain.chat.file["file.search"]({ params, query: { query: "release" } })).toEqual([
        { path: "notes/release-plan.md", type: "file" },
      ])
      const id = SessionMessage.ID.create()
      const mentioned = stub.script()
      const text = `@general and @opencode ${mentioned.marker}`
      yield* brain.chat.session["session.prompt"]({
        params,
        payload: {
          id,
          text,
          delivery: "steer",
          agents: [{ name: "general", mention: { start: 0, end: 8, text: "@general" } }],
          skills: [{ id: "opencode", mention: { start: 13, end: 22, text: "@opencode" } }],
        },
      })
      yield* Effect.promise(() => mentioned.called())
      yield* brain.opencode.session.wait({ sessionID: SessionID.make(brain.id) })
      expect(yield* brain.chat.session["session.message"]({ params: { ...params, messageID: id } })).toMatchObject({
        agents: [{ name: "general" }],
        skills: [{ id: "opencode" }],
      })
      const reviewed = stub.script()
      yield* brain.chat.session["session.command"]({
        params,
        payload: { name: "review", text: reviewed.marker, delivery: "steer" },
      })
      expect((yield* Effect.promise(() => reviewed.called())).text).toContain(reviewed.marker)
      const unknown = yield* brain.chat.session["session.command"]({
        params,
        payload: { name: "missing", text: "", delivery: "steer" },
      }).pipe(Effect.flip)
      expect(unknown._tag).toBe("NotFoundError")
      const outside = yield* brain.chat.agent["agent.list"]({ params: { sessionID: Session.ID.create() } }).pipe(
        Effect.flip,
      )
      expect(outside._tag).toBe("NotFoundError")
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

test("a client token for one chat reads that chat and its child, and gets ForbiddenError for every route of another chat", () =>
  live(
    Effect.gen(function* () {
      const brain = yield* BrainTest.make()
      yield* brain.start()
      const other = Session.ID.create()
      yield* brain.start({ sessionId: other })
      const child = yield* brain.opencode.session.create({
        id: SessionID.make(`${brain.id}_child`),
        parentID: SessionID.make(brain.id),
      })
      const own = yield* brain.chatAs({ sub: "user_1", sid: brain.id })
      yield* own.session["session.get"]({ params: { sessionID: brain.id } })
      yield* own.session["session.get"]({ params: { sessionID: Session.ID.make(child.id) } })
      const params = { sessionID: other }
      const refused = yield* Effect.all([
        own.session["session.get"]({ params }).pipe(Effect.flip),
        own.session["session.messages"]({ params, query: { limit: 20 } }).pipe(Effect.flip),
        own.session["session.prompt"]({
          params,
          payload: { id: SessionMessage.ID.create(), text: "hi", delivery: "steer" },
        }).pipe(Effect.flip),
        own.shell["shell.list"]({ params }).pipe(Effect.flip),
        own.agent["agent.list"]({ params }).pipe(Effect.flip),
        own.file["file.search"]({ params, query: { query: "a" } }).pipe(Effect.flip),
        own.websearch["websearch.providers"]({ params }).pipe(Effect.flip),
      ])
      expect(refused.map((error) => error._tag)).toEqual(refused.map(() => "ForbiddenError"))
    }),
  ))

test("the stream reports connected with the harness's own frame, once the harness stream is subscribed", () =>
  live(
    Effect.gen(function* () {
      const upstream = yield* Queue.unbounded<SessionEvent.Event | typeof SessionEvent.Connected.Type>()
      const frames = yield* Queue.unbounded<SessionEvent.Frame>()
      yield* Chat.frames({
        live: Stream.fromQueue(upstream),
        active: Effect.succeed(false),
        idleMs: 60_000,
        heartbeatMs: 60_000,
      }).pipe(
        Stream.runForEach((frame) => Queue.offer(frames, frame)),
        Effect.forkScoped,
      )
      yield* Queue.offer(upstream, { id: "evt_upstream", created: 1, type: "server.connected", data: {} })
      expect(yield* Queue.take(frames)).toEqual({ id: "evt_upstream", created: 1, type: "server.connected", data: {} })
    }),
  ))

test("a failing harness stream ends the client stream and is logged, not taken for a disconnect", () =>
  live(
    Effect.gen(function* () {
      const messages: Array<string> = []
      const frames = yield* Chat.frames({
        live: Stream.fail(new Error("upstream broke")),
        active: Effect.succeed(false),
        idleMs: 60_000,
        heartbeatMs: 60_000,
      }).pipe(
        Stream.runCollect,
        Effect.provide(
          Logger.layer([Logger.make((options) => void messages.push([options.message].flat().map(String).join(" ")))]),
        ),
      )
      expect(frames).toEqual([])
      expect(messages.join("\n")).toContain("The chat event stream failed")
    }),
  ))

it.effect("the event stream sends heartbeats while a turn runs, and ends once the brain is idle and quiet", () =>
  Effect.gen(function* () {
    const upstream = yield* Queue.unbounded<SessionEvent.Event | typeof SessionEvent.Connected.Type>()
    const busy = yield* Ref.make(true)
    const frames = yield* Queue.unbounded<SessionEvent.Frame>()
    yield* Chat.frames({
      live: Stream.fromQueue(upstream),
      active: Ref.get(busy),
      idleMs: 300,
      heartbeatMs: 100,
    }).pipe(
      Stream.runForEach((frame) => Queue.offer(frames, frame)),
      Effect.forkScoped,
    )
    yield* Queue.offer(upstream, { id: "evt_upstream", created: 0, type: "server.connected", data: {} })
    expect((yield* Queue.take(frames)).type).toBe("server.connected")
    const tick = Effect.gen(function* () {
      yield* TestClock.adjust("100 millis")
      return (yield* Queue.take(frames)).type
    })
    expect(yield* Effect.all(Array.from({ length: 5 }, () => tick))).toEqual(Array(5).fill("server.heartbeat"))
    yield* Ref.set(busy, false)
    yield* Queue.offer(upstream, {
      id: "evt_title",
      created: 0,
      type: "session.renamed",
      data: { sessionID: Session.ID.create(), title: "Plan" },
    })
    expect((yield* Queue.take(frames)).type).toBe("session.renamed")
    expect(yield* Effect.all([tick, tick])).toEqual(["server.heartbeat", "server.heartbeat"])
    expect(yield* tick).toBe("stream.ended")
  }),
)
