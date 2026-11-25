import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import { OpenCodeHost } from "@ren/cell/testing"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Effect, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const model = { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") }

process.env["REN_TOKEN"] = "user-token"

type Ren = Effect.Success<ReturnType<typeof RenServer.make>>

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const answer = (ren: Ren, sessionID: string, text: string, options: { readonly ended?: boolean } = {}) => {
  const step = { sessionID, assistantMessageID: SessionMessage.ID.create() }
  ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
  ren.send(RenServer.frame("session.text.delta", { ...step, ordinal: 0, delta: text }))
  if (options.ended === false) return step
  ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text }))
  ren.send(
    RenServer.frame("session.step.ended", {
      ...step,
      finish: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )
  return step
}

const deliver = (ren: Ren, sessionID: string, id: string) => {
  ren.state.delivered.add(id)
  ren.send(RenServer.frame("session.inbox.delivered", { sessionID, inboxID: id }))
}

const succeed = (ren: Ren, sessionID: string) => ren.send(RenServer.frame("session.execution.succeeded", { sessionID }))

const setup = Effect.fnUntraced(function* (ren?: Ren) {
  const server = ren ?? (yield* RenServer.make())
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: server.url, space: server.state.spaceId } }],
  })
  const delivered = yield* Queue.unbounded<string>()
  const connected = yield* Queue.unbounded<void>()
  yield* host.client.event.subscribe({ types: ["session.inbox.delivered"] }).pipe(
    Stream.runForEach((event) =>
      event.type === "session.inbox.delivered"
        ? Queue.offer(delivered, event.data.inboxID)
        : Queue.offer(connected, undefined),
    ),
    Effect.forkScoped,
  )
  yield* Queue.take(connected)
  const open = Effect.fnUntraced(function* () {
    const session = yield* host.client.session.create({ location: host.location, model }).pipe(Effect.orDie)
    const sessionID = session.id
    const prompt = (text: string) =>
      host.client.session.prompt({ sessionID, text }).pipe(
        Effect.orDie,
        Effect.tap(() => host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)),
      )
    const settled = (id: string): Effect.Effect<void> =>
      Queue.take(delivered).pipe(
        Effect.flatMap((next) =>
          next === id ? host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie) : settled(id),
        ),
      )
    const remote = (
      text: string,
      fields: Partial<SessionMessage.User> = { sender: { userId: server.state.bea.id } },
    ) => {
      const id = SessionMessage.ID.create()
      server.state.messages.set(id, { id, type: "user", text, time: { created: DateTime.nowUnsafe() }, ...fields })
      return id
    }
    const messages = host.client.session.context({ sessionID }).pipe(Effect.orDie)
    const transcript = Effect.map(messages, (all) =>
      all.flatMap((message) => {
        if (message.type === "user") return [`user:${message.text}`]
        if (message.type !== "assistant") return []
        return [
          message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ||
            `(empty${message.error ? `: ${message.error.message}` : ""})`,
        ]
      }),
    )
    return { sessionID, prompt, settled, remote, messages, transcript }
  })
  return { ren: server, host, delivered, open }
})

const replying = (ren: Ren, text: string) => (prompt: RenServer.Prompt) => {
  deliver(ren, prompt.sessionID, prompt.id)
  answer(ren, prompt.sessionID, text)
  succeed(ren, prompt.sessionID)
}

const turn = (ren: Ren, sessionID: string, id: string, text: string) => {
  ren.send(RenServer.frame("session.execution.started", { sessionID }))
  deliver(ren, sessionID, id)
  answer(ren, sessionID, text)
  succeed(ren, sessionID)
}

test("a message another member sent from another client becomes a local user message with their name and the Ren message ID, and the local turn streams the brain's answer without sending it again", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open()
      opened.ren.state.answer = replying(opened.ren, "hello back")
      yield* session.prompt("hello")
      const id = session.remote("what next?")
      turn(opened.ren, session.sessionID, id, "lunch")
      yield* session.settled(id)
      expect(yield* session.transcript).toEqual(["user:hello", "hello back", "user:Bea: what next?", "lunch"])
      expect((yield* session.messages).find((message) => String(message.id) === id)).toMatchObject({
        type: "user",
        metadata: { userID: opened.ren.state.bea.id, userName: "Bea", remote: true },
      })
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["hello"])
    }),
  ))

test("the signed-in user's own message from another client appears without a name, and a message this OpenCode sent is not mirrored back", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open()
      opened.ren.state.answer = replying(opened.ren, "hello back")
      const sent = yield* session.prompt("hello")
      const own = session.remote("from the web", { sender: { userId: opened.ren.state.me.id } })
      turn(opened.ren, session.sessionID, own, "web answer")
      yield* session.settled(own)
      turn(opened.ren, session.sessionID, sent.id, "again")
      const later = session.remote("later")
      turn(opened.ren, session.sessionID, later, "later answer")
      yield* session.settled(later)
      expect(yield* session.transcript).toEqual([
        "user:hello",
        "hello back",
        "user:from the web",
        "web answer",
        "user:Bea: later",
        "later answer",
      ])
    }),
  ))

test("a message from a channel, a schedule, a webhook or a task shows where it came from instead of a person", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open()
      opened.ren.state.answer = replying(opened.ren, "hello back")
      yield* session.prompt("hello")
      const sender = { userId: opened.ren.state.bea.id }
      const origins: ReadonlyArray<Partial<SessionMessage.User>> = [
        { sender, channel: { provider: "slack", place: "#eng", sender: "Cam" } },
        { sender, schedule: { scheduleId: "sch_1", name: "Daily digest", scheduledAt: "2026-11-23T09:00:00Z" } },
        {
          sender,
          webhook: { webhookId: "whk_1", name: "Deploys", requestId: "req_1", receivedAt: "2026-11-23T09:00:00Z" },
        },
        { sender, task: { taskId: "tsk_1", identifier: "REN-12", title: "Fix it", brief: "Fix the bug." } },
      ]
      yield* Effect.forEach(
        origins,
        Effect.fnUntraced(function* (fields, index) {
          const id = session.remote(`message ${index}`, fields)
          turn(opened.ren, session.sessionID, id, `answer ${index}`)
          yield* session.settled(id)
        }),
      )
      expect((yield* session.transcript).filter((line) => line.startsWith("user:"))).toEqual([
        "user:hello",
        "user:Cam via Slack: message 0",
        "user:Schedule Daily digest: message 1",
        "user:Webhook Deploys: message 2",
        "user:Task REN-12: message 3",
      ])
    }),
  ))

test("a teammate's message delivered during a local turn ends the local step at its delivery, and its answer streams in its own turn after it", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open()
      const steer = session.remote("also check the tests")
      opened.ren.state.answer = (prompt) => {
        deliver(opened.ren, prompt.sessionID, prompt.id)
        answer(opened.ren, prompt.sessionID, "first answer")
        opened.ren.send(
          RenServer.frame("session.inbox.enqueued", {
            sessionID: prompt.sessionID,
            inboxID: steer,
            item: {
              type: "user",
              payload: { text: "also check the tests", sender: { userId: opened.ren.state.bea.id } },
              delivery: "steer",
            },
          }),
        )
        deliver(opened.ren, prompt.sessionID, steer)
        answer(opened.ren, prompt.sessionID, "second answer")
        succeed(opened.ren, prompt.sessionID)
      }
      yield* session.prompt("hello")
      yield* session.settled(steer)
      expect(yield* session.transcript).toEqual([
        "user:hello",
        "first answer",
        "user:Bea: also check the tests",
        "second answer",
      ])
      expect(opened.ren.state.prompts.map((prompt) => prompt.text)).toEqual(["hello"])
    }),
  ))

test("a local prompt sent while a mirrored turn streams is sent to the brain after that turn ends", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open()
      opened.ren.state.answer = replying(opened.ren, "hello back")
      yield* session.prompt("hello")
      const id = session.remote("a long task")
      opened.ren.send(RenServer.frame("session.execution.started", { sessionID: session.sessionID }))
      deliver(opened.ren, session.sessionID, id)
      const step = answer(opened.ren, session.sessionID, "working", { ended: false })
      yield* Queue.take(opened.delivered).pipe(Effect.repeat({ until: (next) => next === id }))
      const order: Array<string> = []
      const ended = { value: false }
      opened.ren.state.answer = (prompt) => {
        order.push(ended.value ? "after the mirrored turn" : "during the mirrored turn")
        replying(opened.ren, "y answer")(prompt)
      }
      const local = yield* opened.host.client.session
        .prompt({ sessionID: session.sessionID, text: "meanwhile" })
        .pipe(Effect.orDie)
      ended.value = true
      opened.ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text: "working" }))
      succeed(opened.ren, session.sessionID)
      yield* session.settled(local.id)
      expect(order).toEqual(["after the mirrored turn"])
      expect(yield* session.transcript).toEqual([
        "user:hello",
        "hello back",
        "user:Bea: a long task",
        "working",
        "user:meanwhile",
        "y answer",
      ])
    }),
  ))

test("after the event stream reconnects, a delivery seen again does not admit the message twice, and admitting an existing message ID changes nothing", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open()
      opened.ren.state.answer = replying(opened.ren, "hello back")
      yield* session.prompt("hello")
      const id = session.remote("once")
      turn(opened.ren, session.sessionID, id, "once answer")
      yield* session.settled(id)
      yield* Queue.clear(opened.ren.opened)
      opened.ren.drop()
      yield* Queue.take(opened.ren.opened)
      turn(opened.ren, session.sessionID, id, "repeated")
      const later = session.remote("later")
      turn(opened.ren, session.sessionID, later, "later answer")
      yield* session.settled(later)
      const before = yield* session.transcript
      expect(before).toEqual([
        "user:hello",
        "hello back",
        "user:Bea: once",
        "once answer",
        "user:Bea: later",
        "later answer",
      ])
      const again = yield* opened.host.client.session
        .prompt({ sessionID: session.sessionID, id: Binding.LocalMessageID.make(id), text: "changed" })
        .pipe(Effect.orDie)
      expect(again).toMatchObject({ id, type: "user", payload: { text: "Bea: once" } })
      yield* opened.host.client.experimental.session.wait({ sessionID: session.sessionID }).pipe(Effect.orDie)
      expect(yield* session.transcript).toEqual(before)
    }),
  ))

test("a Ren session's link stays open only while the session is in use: the brain's idle end closes it, and the next prompt watches the session again", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = yield* opened.open()
      opened.ren.state.answer = replying(opened.ren, "hello back")
      yield* session.prompt("hello")
      opened.ren.send(RenServer.frame("stream.ended", { reason: "idle" }))
      expect(yield* Queue.take(opened.ren.closed)).toBe(session.sessionID)
      yield* session.prompt("again")
      const id = session.remote("after the pause")
      turn(opened.ren, session.sessionID, id, "still here")
      yield* session.settled(id)
      expect((yield* session.transcript).slice(-2)).toEqual(["user:Bea: after the pause", "still here"])
    }),
  ))

test("the plugin watches at most four Ren sessions at once and lets go of the one used longest ago", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = replying(opened.ren, "hello back")
      const first = yield* opened.open()
      yield* first.prompt("hello")
      yield* Effect.forEach([2, 3, 4], () => opened.open().pipe(Effect.tap((session) => session.prompt("hello"))))
      expect(yield* Queue.size(opened.ren.closed)).toBe(0)
      const fifth = yield* opened.open()
      yield* fifth.prompt("hello")
      expect(yield* Queue.take(opened.ren.closed)).toBe(first.sessionID)
    }),
  ))
