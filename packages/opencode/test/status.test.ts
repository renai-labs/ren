import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* () {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({ plugins: [{ package: plugin, options: { url: ren.url } }] })
  const rpc = host.client.rpc(RenRpc.Definition)
  const at = { location: host.location }
  const created = yield* rpc.createSession({}, at)
  const sessionID = Binding.LocalID.make(created.sessionID)
  const toasts: Array<ToastOptions> = []
  const surface: RenCommands.Surface = {
    client: host.promise,
    location: () => host.location,
    ui: {
      dialog: { select: () => Promise.resolve(undefined), confirm: () => Promise.resolve(false) },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: () => undefined, current: () => ({ type: "home" }) },
      model: { current: () => undefined },
    },
  }
  const wait = host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
  const prompt = (text: string) =>
    host.client.session.prompt({ sessionID, text }).pipe(
      Effect.orDie,
      Effect.tap(() => wait),
    )
  const messages = host.client.session.context({ sessionID }).pipe(Effect.orDie)
  const errors = Effect.map(messages, (all) =>
    all.flatMap((message) => (message.type === "assistant" && message.error ? [message.error.message] : [])),
  )
  const status = rpc.sessionStatus({ sessionID }, at)
  const retry = Effect.promise(() => RenCommands.retry(surface, { sessionID, running: false }))
  return { ren, host, rpc, at, sessionID, surface, toasts, wait, prompt, messages, errors, status, retry }
})

const reply = (ren: Effect.Success<ReturnType<typeof setup>>["ren"], prompt: RenServer.Prompt, text: string) => {
  const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
  ren.state.delivered.add(prompt.id)
  ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
  ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
  ren.send(RenServer.frame("session.text.delta", { ...step, ordinal: 0, delta: text }))
  ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text }))
  ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
}

const texts = (messages: ReadonlyArray<{ readonly type: string }>) =>
  messages.flatMap((message) =>
    "content" in message && Array.isArray(message.content)
      ? message.content.flatMap((part: { readonly type: string; readonly text?: string }) =>
          part.type === "text" ? [part.text] : [],
        )
      : [],
  )

test("a Ren session's status shows the brain starting with Ren's phase while the turn waits, and each change reaches subscribers", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      expect(yield* opened.status).toEqual({
        sessionID: opened.sessionID,
        ren: true,
        space: "Alpha",
        state: "closed",
        detail: "",
        retryAt: 0,
        busy: false,
      })
      const events = yield* Queue.unbounded<{ readonly type: string; readonly data: unknown }>()
      yield* opened.host.client.event.subscribe({ types: ["rpc.ren.statusChanged"] }).pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped,
      )
      expect((yield* Queue.take(events)).type).toBe("server.connected")
      opened.ren.state.boot.set(opened.sessionID, { status: "starting", phase: "waking the brain" })
      yield* opened.host.client.session.prompt({ sessionID: opened.sessionID, text: "hello" }).pipe(Effect.orDie)
      const next = (state: string): Effect.Effect<unknown> =>
        Queue.take(events).pipe(
          Effect.flatMap((event) =>
            event.data && typeof event.data === "object" && "state" in event.data && event.data.state === state
              ? Effect.succeed(event.data)
              : next(state),
          ),
        )
      expect(yield* next("starting")).toMatchObject({ sessionID: opened.sessionID, detail: "waking the brain" })
      expect(texts(yield* opened.messages)).toEqual([])
      yield* opened.host.client.session.interrupt({ sessionID: opened.sessionID }).pipe(Effect.orDie)
    }),
  ))

test("reading the status of a Ren session that has no open link does not ask Ren for chat access, so it wakes no brain", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const local = yield* opened.host.client.session.get({ sessionID: opened.sessionID }).pipe(Effect.orDie)
      yield* opened.host.client.session
        .update({
          sessionID: opened.sessionID,
          metadata: { ren: { spaceId: opened.ren.state.spaceId, sessionId: opened.sessionID } },
        })
        .pipe(Effect.orDie)
      expect(local.metadata).toEqual({ ren: { spaceId: opened.ren.state.spaceId } })
      expect(yield* opened.status).toMatchObject({ ren: true, space: "Alpha", state: "closed" })
      expect(opened.ren.state.accessed).toEqual([])
    }),
  ))

test("a brain that fails to start fails the turn with Ren's reason, and the status shows it", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.boot.set(opened.sessionID, { status: "failed", reason: "no capacity" })
      yield* opened.prompt("hello")
      expect(yield* opened.errors).toEqual(["Ren could not open this session’s brain: no capacity. Run /ren:retry."])
      expect(yield* opened.status).toMatchObject({ state: "failed", detail: "no capacity" })
      expect(opened.ren.state.prompts).toEqual([])
    }),
  ))

test("/ren:retry on a stopped session asks Ren to start it again without a message, reopens its link, and sends the unanswered message once", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.boot.set(opened.sessionID, { status: "stopped" })
      const sent = yield* opened.prompt("hello")
      expect(yield* opened.errors).toEqual([
        "Ren could not open this session’s brain: The space was shut down. Run /ren:retry.",
      ])
      expect(yield* opened.status).toMatchObject({ state: "stopped" })
      opened.ren.state.answer = (prompt) => reply(opened.ren, prompt, "after the restart")
      yield* opened.retry
      expect(opened.toasts).toEqual([
        {
          title: "Ren",
          message: "Ren is starting this session’s brain again. Your last message goes to it once it is ready.",
          variant: "success",
        },
      ])
      expect(opened.ren.state.retries).toEqual([
        { sessionID: opened.sessionID, body: JSON.stringify({ message: null }) },
      ])
      yield* Queue.take(opened.ren.prompted)
      yield* opened.wait
      expect(opened.ren.state.prompts.map((prompt) => [prompt.id, prompt.text])).toEqual([[sent.id, "hello"]])
      expect(texts(yield* opened.messages)).toContain("after the restart")
      expect(yield* opened.status).toMatchObject({ state: "ready" })
    }),
  ))

test("/ren:retry after a turn that failed on the brain sends the message again once, as a new message", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => {
        opened.ren.state.delivered.add(prompt.id)
        opened.ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
        opened.ren.send(
          RenServer.frame("session.execution.failed", {
            sessionID: prompt.sessionID,
            error: { type: "unknown", message: "the model failed" },
          }),
        )
      }
      const sent = yield* opened.prompt("hello")
      opened.ren.state.answer = (prompt) => reply(opened.ren, prompt, "the second try")
      yield* opened.retry
      yield* Queue.take(opened.ren.prompted)
      yield* Queue.take(opened.ren.prompted)
      yield* opened.wait
      expect(opened.toasts.map((toast) => toast.message)).toEqual([
        "Ren had your last message and its turn failed, so it was sent again.",
      ])
      expect(opened.ren.state.retries).toEqual([])
      const prompts = opened.ren.state.prompts
      expect(prompts.map((prompt) => prompt.text)).toEqual(["hello", "hello"])
      expect(prompts.at(0)?.id).toBe(sent.id)
      expect(prompts.at(1)?.id).not.toBe(sent.id)
      expect(texts(yield* opened.messages)).toContain("the second try")
    }),
  ))

test("/ren:retry says so when nothing needs a retry, and refuses a session that is not a Ren session", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => reply(opened.ren, prompt, "fine")
      yield* opened.prompt("hello")
      yield* opened.retry
      const local = yield* opened.host.client.session.create({ location: opened.host.location }).pipe(Effect.orDie)
      expect(yield* opened.rpc.sessionStatus({ sessionID: local.id }, opened.at)).toMatchObject({ ren: false })
      yield* Effect.promise(() => RenCommands.retry(opened.surface, { sessionID: local.id, running: false }))
      expect(opened.toasts).toEqual([
        { title: "Ren", message: "Nothing to retry: the last turn of this Ren session did not fail.", variant: "info" },
        { title: "Ren", message: "This is not a Ren session.", variant: "error" },
      ])
      expect(opened.ren.state.prompts).toHaveLength(1)
    }),
  ))
