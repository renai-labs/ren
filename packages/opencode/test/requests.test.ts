import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { Model, Provider } from "@opencode/plugin/effect"
import type { DialogSelectOptions, ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Fiber, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))
const model = { providerID: Provider.ID.make("ren"), id: Model.ID.make("stub/stub-model") }

process.env["REN_TOKEN"] = "user-token"

type Ren = Effect.Success<ReturnType<typeof RenServer.make>>

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const watched = [
  "permission.asked",
  "permission.replied",
  "form.created",
  "form.replied",
  "form.cancelled",
  "session.inbox.delivered",
] as const

interface Seen {
  readonly type: string
  readonly data: Record<string, unknown>
}

const setup = Effect.fnUntraced(function* () {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: ren.url, space: ren.state.spaceId } }],
  })
  const queues = yield* Effect.all({
    "permission.asked": Queue.unbounded<Seen>(),
    "permission.replied": Queue.unbounded<Seen>(),
    "form.created": Queue.unbounded<Seen>(),
    "form.replied": Queue.unbounded<Seen>(),
    "form.cancelled": Queue.unbounded<Seen>(),
    "session.inbox.delivered": Queue.unbounded<Seen>(),
  })
  const connected = yield* Queue.unbounded<void>()
  yield* host.client.event.subscribe({ types: [...watched] }).pipe(
    Stream.runForEach((event) =>
      event.type === "server.connected"
        ? Queue.offer(connected, undefined)
        : Queue.offer(queues[event.type], { type: event.type, data: event.data }),
    ),
    Effect.forkScoped,
  )
  yield* Queue.take(connected)
  const next = (type: (typeof watched)[number]) => Queue.take(queues[type])
  const session = yield* host.client.session.create({ location: host.location, model }).pipe(Effect.orDie)
  const sessionID = Session.ID.make(session.id)
  const local = Binding.LocalID.make(session.id)
  const toasts: Array<ToastOptions> = []
  const surface: RenCommands.RequestSurface = {
    client: host.promise,
    location: () => host.location,
    ui: {
      dialog: {
        select: <Value>(_dialog: DialogSelectOptions<Value>) => Promise.resolve(undefined),
        confirm: () => Promise.resolve(false),
      },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: () => undefined, current: () => ({ type: "home" }) },
      model: { current: () => undefined },
    },
  }
  const tui = Effect.gen(function* () {
    const live = Promise.withResolvers<void>()
    const listening = new AbortController()
    yield* Effect.addFinalizer(() => Effect.sync(() => listening.abort()))
    void (async () => {
      for await (const event of host.promise.event.subscribe({ signal: listening.signal }))
        if (event.type === "server.connected") live.resolve()
    })().catch(() => undefined)
    yield* Effect.promise(() => live.promise)
    const stop = yield* Effect.promise(() => RenCommands.requests(surface))
    yield* Effect.addFinalizer(() => Effect.sync(stop))
  })
  const turn = (text: string) =>
    host.client.session.prompt({ sessionID: local, text }).pipe(
      Effect.orDie,
      Effect.tap(() => host.client.experimental.session.wait({ sessionID: local }).pipe(Effect.orDie)),
      Effect.forkScoped,
    )
  const transcript = host.client.session.context({ sessionID: local }).pipe(
    Effect.orDie,
    Effect.map((all) =>
      all.flatMap((message) => {
        if (message.type === "user") return [`user:${message.text}`]
        if (message.type !== "assistant") return []
        return [message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")]
      }),
    ),
  )
  const pending = host.client.permission.list({ sessionID: local }).pipe(Effect.orDie)
  const reply = (requests: Effect.Success<typeof pending>, decision: "once" | "always" | "reject", message?: string) =>
    Effect.forEach(requests, (request) =>
      host.client.permission
        .reply({ sessionID: local, requestID: request.id, decision, ...(message && { message }) })
        .pipe(Effect.orDie),
    )
  const forms = host.client.session.form.list({ sessionID: local }).pipe(Effect.orDie)
  return { ren, host, next, sessionID, local, toasts, tui, turn, transcript, pending, reply, forms }
})

const started = (ren: Ren, prompt: RenServer.Prompt) => {
  ren.state.delivered.add(prompt.id)
  ren.send(RenServer.frame("session.execution.started", { sessionID: prompt.sessionID }))
  ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
}

const finish = (ren: Ren, sessionID: string, text: string) => {
  const step = { sessionID, assistantMessageID: SessionMessage.ID.create() }
  ren.send(RenServer.frame("session.text.started", { ...step, ordinal: 0 }))
  ren.send(RenServer.frame("session.text.delta", { ...step, ordinal: 0, delta: text }))
  ren.send(RenServer.frame("session.text.ended", { ...step, ordinal: 0, text }))
  ren.send(
    RenServer.frame("session.step.ended", {
      ...step,
      finish: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )
  ren.send(RenServer.frame("session.execution.succeeded", { sessionID }))
}

const ask = (ren: Ren, request: Omit<Permission.Request, "id">) => {
  const asked: Permission.Request = { id: Permission.RequestID.make(`per_${crypto.randomUUID()}`), ...request }
  ren.state.permissions.push(asked)
  ren.send(RenServer.frame("permission.asked", asked))
  return asked
}

const question = (ren: Ren, form: Omit<Form.Info, "id">) => {
  const asked: Form.Info = { id: Form.ID.make(`frm_${crypto.randomUUID()}`), ...form }
  ren.state.forms.push(asked)
  ren.send(RenServer.frame("form.created", { form: asked }))
  return asked
}

const questions = (sessionID: string): Omit<Form.Info, "id"> => ({
  sessionID,
  title: "Pick a database",
  kind: "question",
  fields: [
    {
      key: "engine",
      type: "string",
      title: "Which engine?",
      options: [
        { value: "postgres", label: "Postgres" },
        { value: "sqlite", label: "SQLite" },
      ],
    },
    {
      key: "extras",
      type: "multiselect",
      title: "Which extras?",
      options: [
        { value: "backups", label: "Backups" },
        { value: "replicas", label: "Replicas" },
      ],
    },
  ],
})

test("a permission request during a local turn becomes OpenCode's own permission prompt in the local session, the local answer reaches the brain once with always passed through, and the turn goes on", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const asking = { request: undefined as Permission.Request | undefined }
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        asking.request = ask(opened.ren, {
          sessionID: opened.sessionID,
          action: "shell",
          resources: ["git push"],
          save: ["git *"],
          metadata: { command: "git push" },
        })
      }
      const turn = yield* opened.turn("push it")
      yield* opened.next("permission.asked")
      const local = yield* opened.pending
      expect(local).toMatchObject([
        {
          sessionID: opened.sessionID,
          action: "shell",
          resources: ["git push"],
          save: ["git * (on Ren)"],
          metadata: { command: "git push", ren: { requestID: asking.request?.id, sessionID: opened.sessionID } },
        },
      ])
      yield* opened.reply(local, "always")
      expect(yield* Queue.take(opened.ren.answered)).toEqual({
        type: "permission",
        requestID: asking.request?.id ?? "",
        reply: "always",
      })
      finish(opened.ren, opened.sessionID, "pushed")
      yield* Fiber.join(turn)
      expect(yield* opened.transcript).toEqual(["user:push it", "pushed"])
      expect(opened.ren.state.answers).toHaveLength(1)
      expect(yield* opened.host.client.permission.list({ sessionID: opened.local }).pipe(Effect.orDie)).toEqual([])
    }),
  ))

test("a subagent's permission request shows on the root session the user looks at, and a rejection with a message reaches the subagent's request on the brain", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const child = Session.ID.create()
      const asking = { request: undefined as Permission.Request | undefined }
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        asking.request = ask(opened.ren, { sessionID: child, action: "webfetch", resources: ["https://example.com"] })
      }
      const turn = yield* opened.turn("look it up")
      yield* opened.next("permission.asked")
      const local = yield* opened.pending
      expect(local).toMatchObject([
        { sessionID: opened.sessionID, action: "webfetch", metadata: { ren: { sessionID: child } } },
      ])
      expect(local[0]?.save).toBeUndefined()
      yield* opened.reply(local, "reject", "Use the cached copy")
      expect(yield* Queue.take(opened.ren.answered)).toEqual({
        type: "permission",
        requestID: asking.request?.id ?? "",
        reply: "reject",
        message: "Use the cached copy",
      })
      finish(opened.ren, opened.sessionID, "used the cache")
      yield* Fiber.join(turn)
      expect(yield* opened.transcript).toEqual(["user:look it up", "used the cache"])
    }),
  ))

test("a rejection without a message, as the stock TUI gives on a root session, reaches the brain as a plain rejection", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const asking = { request: undefined as Permission.Request | undefined }
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        asking.request = ask(opened.ren, { sessionID: opened.sessionID, action: "edit", resources: ["src/app.ts"] })
      }
      const turn = yield* opened.turn("edit it")
      yield* opened.next("permission.asked")
      yield* opened.reply(yield* opened.pending, "reject")
      expect(yield* Queue.take(opened.ren.answered)).toEqual({
        type: "permission",
        requestID: asking.request?.id ?? "",
        reply: "reject",
      })
      finish(opened.ren, opened.sessionID, "left it")
      yield* Fiber.join(turn)
    }),
  ))

test("a permission request or a question that another client answers first closes in the local session, the TUI says so, and nothing goes to the brain", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.tui
      const asking = { request: undefined as Permission.Request | undefined }
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        asking.request = ask(opened.ren, { sessionID: opened.sessionID, action: "shell", resources: ["rm -rf dist"] })
      }
      const turn = yield* opened.turn("clean up")
      yield* opened.next("permission.asked")
      opened.ren.state.permissions = []
      opened.ren.send(
        RenServer.frame("permission.replied", {
          sessionID: opened.sessionID,
          requestID: asking.request?.id,
          reply: "reject",
        }),
      )
      yield* opened.next("permission.replied")
      expect(yield* opened.pending).toEqual([])
      const form = question(opened.ren, questions(opened.sessionID))
      yield* opened.next("form.created")
      expect((yield* opened.forms).map((each) => each.id)).toEqual([form.id])
      opened.ren.state.forms = []
      opened.ren.send(
        RenServer.frame("form.replied", { id: form.id, sessionID: opened.sessionID, answer: { engine: "sqlite" } }),
      )
      yield* opened.next("form.cancelled")
      expect(yield* opened.forms).toEqual([])
      expect(opened.toasts).toEqual([
        { title: "Ren", message: "shell rm -rf dist was rejected on Ren.", variant: "info" },
        { title: "Ren", message: "Pick a database was answered on Ren.", variant: "info" },
      ])
      finish(opened.ren, opened.sessionID, "done")
      yield* Fiber.join(turn)
      expect(opened.ren.state.answers).toEqual([])
    }),
  ))

test("after the event stream reconnects, requests asked meanwhile appear and ones answered meanwhile close, and a TUI that starts later shows the pending questions", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        ask(opened.ren, { sessionID: opened.sessionID, action: "shell", resources: ["make"] })
      }
      const turn = yield* opened.turn("build it")
      yield* opened.next("permission.asked")
      yield* Queue.clear(opened.ren.opened)
      const later: Permission.Request = {
        id: Permission.RequestID.make(`per_${crypto.randomUUID()}`),
        sessionID: opened.sessionID,
        action: "shell",
        resources: ["make install"],
      }
      opened.ren.state.permissions = [later]
      const form: Form.Info = { id: Form.ID.make(`frm_${crypto.randomUUID()}`), ...questions(opened.sessionID) }
      opened.ren.state.forms = [form]
      opened.ren.drop()
      yield* Queue.take(opened.ren.opened)
      yield* opened.next("permission.replied")
      yield* opened.next("permission.asked")
      const local = yield* opened.pending
      expect(local.map((each) => each.resources)).toEqual([["make install"]])
      yield* opened.tui
      yield* opened.next("form.created")
      expect(yield* opened.forms).toMatchObject([{ id: form.id, title: "Pick a database" }])
      yield* opened.reply(local, "once")
      expect(yield* Queue.take(opened.ren.answered)).toEqual({ type: "permission", requestID: later.id, reply: "once" })
      finish(opened.ren, opened.sessionID, "built")
      yield* Fiber.join(turn)
      expect(opened.ren.state.answers).toHaveLength(1)
    }),
  ))

test("a question with several fields becomes OpenCode's own form, and the local answer or dismissal reaches the brain once", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.tui
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        question(opened.ren, questions(opened.sessionID))
      }
      const turn = yield* opened.turn("set up the database")
      yield* opened.next("form.created")
      const [local] = yield* opened.forms
      expect(local).toMatchObject({
        sessionID: opened.sessionID,
        title: "Pick a database",
        metadata: { ren: { sessionID: opened.sessionID, kind: "question" } },
        fields: questions(opened.sessionID).fields,
      })
      if (!local) return
      yield* opened.host.client.session.form
        .reply({ sessionID: opened.local, formID: local.id, answer: { engine: "postgres", extras: ["backups"] } })
        .pipe(Effect.orDie)
      expect(yield* Queue.take(opened.ren.answered)).toEqual({
        type: "form",
        formID: local.id,
        answer: { engine: "postgres", extras: ["backups"] },
      })
      const second = question(opened.ren, questions(opened.sessionID))
      yield* opened.next("form.created")
      yield* opened.host.client.session.form.cancel({ sessionID: opened.local, formID: second.id }).pipe(Effect.orDie)
      expect(yield* Queue.take(opened.ren.answered)).toEqual({ type: "cancel", formID: second.id })
      finish(opened.ren, opened.sessionID, "set up")
      yield* Fiber.join(turn)
      expect(opened.ren.state.answers).toHaveLength(2)
    }),
  ))

test("a question whose turn stopped stays open locally, and its answer goes to the brain as a new message that quotes it", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.tui
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        question(opened.ren, questions(opened.sessionID))
      }
      const turn = yield* opened.turn("set up the database")
      yield* opened.next("form.created")
      const [local] = yield* opened.forms
      if (!local) return
      opened.ren.state.forms = []
      opened.ren.send(RenServer.frame("form.cancelled", { id: local.id, sessionID: opened.sessionID }))
      finish(opened.ren, opened.sessionID, "stopped")
      yield* Fiber.join(turn)
      yield* Queue.clear(opened.ren.prompted)
      opened.ren.state.answer = (prompt) => {
        started(opened.ren, prompt)
        finish(opened.ren, prompt.sessionID, "noted")
      }
      yield* opened.host.client.session.form
        .reply({ sessionID: opened.local, formID: local.id, answer: { engine: "postgres", extras: ["backups"] } })
        .pipe(Effect.orDie)
      expect((yield* Queue.take(opened.ren.prompted)).text).toBe(
        'An answer to an earlier question, "Pick a database":\n\n> Which engine?\npostgres\n\n> Which extras?\nbackups',
      )
      yield* opened.host.client.experimental.session.wait({ sessionID: opened.local }).pipe(Effect.orDie)
      expect((yield* opened.transcript).slice(-1)).toEqual(["noted"])
      expect(opened.ren.state.answers).toEqual([])
    }),
  ))
