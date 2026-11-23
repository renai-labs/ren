import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { Destination, DialogSelectOptions, ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionMessage } from "@ren/schema/session/message"
import { DateTime, Effect, Queue, type Scope, Stream } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { RenRpc } from "../src/rpc.js"
import { Messages } from "./lib/messages.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))

process.env["REN_TOKEN"] = "user-token"

type Ren = Effect.Success<ReturnType<typeof RenServer.make>>

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const started = (ren: Ren, fields: Partial<Session.Info>): Session.Info => {
  const info: Session.Info = {
    id: Session.ID.create(),
    spaceId: ren.state.spaceId,
    createdBy: ren.state.bea.id,
    agentId: null,
    origin: "chat",
    harness: "opencode",
    title: "Trip plan",
    status: "idle",
    capabilities: SessionCapabilities.of("opencode"),
    createdAt: DateTime.nowUnsafe(),
    updatedAt: DateTime.nowUnsafe(),
    archivedAt: null,
    filesResetAt: null,
    ...fields,
  }
  ren.state.sessions.push(info)
  if (info.title) ren.state.titles.set(info.id, info.title)
  return info
}

const replying = (ren: Ren, text: string) => (prompt: RenServer.Prompt) => {
  ren.state.delivered.add(prompt.id)
  const step = { sessionID: prompt.sessionID, assistantMessageID: SessionMessage.ID.create() }
  ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
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
  ren.send(RenServer.frame("session.execution.succeeded", { sessionID: prompt.sessionID }))
}

const setup = Effect.fnUntraced(function* (options: { readonly query?: string } = {}) {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: ren.url, space: ren.state.spaceId } }],
  })
  const shown: Array<{ readonly options: ReadonlyArray<readonly [string, unknown, unknown]> }> = []
  const toasts: Array<ToastOptions> = []
  const routes: Array<Destination> = []
  const surface: RenCommands.OpenSurface = {
    client: host.promise,
    reload: (_sessionID, load) => load().then(() => undefined),
    location: () => host.location,
    ui: {
      dialog: {
        select: <Value>(dialog: DialogSelectOptions<Value>) => {
          shown.push({
            options: dialog.options.map((option) => [option.title, option.description, option.footer] as const),
          })
          return Promise.resolve(dialog.search?.(options.query ?? "", dialog.options).at(0)?.value)
        },
        prompt: () => Promise.resolve(undefined),
        confirm: () => Promise.resolve(false),
      },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: (destination) => routes.push(destination), current: () => ({ type: "home" }) },
      model: { current: () => undefined },
    },
  }
  const local = (sessionID: string) =>
    host.client.session.get({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
  const messages = (sessionID: string) =>
    host.client.session.context({ sessionID: Binding.LocalID.make(sessionID) }).pipe(Effect.orDie)
  const transcript = (sessionID: string) =>
    Effect.map(messages(sessionID), (all) =>
      all.flatMap((message) => {
        if (message.type === "user") return [`user:${message.text}`]
        if (message.type !== "assistant") return []
        return [message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")]
      }),
    )
  const rpc = host.client.rpc(RenRpc.Definition)
  return {
    ren,
    host,
    rpc,
    at: { location: host.location },
    surface,
    shown,
    toasts,
    routes,
    local,
    messages,
    transcript,
  }
})

const conversation = (ren: Ren) => [
  Messages.user(0, "plan the trip", { sender: { userId: ren.state.bea.id } }),
  Messages.assistant(1, [{ type: "reasoning", text: "Check the notes." }, Messages.text("Reading"), Messages.tool(2)]),
  Messages.idle(3),
  Messages.user(4, "the raw text", {
    sender: { userId: ren.state.me.id },
    presentation: { displayText: "thanks", comments: [] },
  }),
  Messages.assistant(5, [Messages.text("welcome")]),
  Messages.user(6, "book it", {
    sender: { userId: ren.state.bea.id },
    channel: { provider: "slack", place: "#trips", sender: "Cam" },
  }),
  Messages.assistant(7, [Messages.text("booked")]),
]

test("the session list asks Ren for the selected space's sessions with the filters, names who started each, and marks the ones with a local copy", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const theirs = started(opened.ren, { title: "Trip plan" })
      const mine = started(opened.ren, { title: "Mine", createdBy: opened.ren.state.me.id, origin: "slack" })
      started(opened.ren, { title: "Elsewhere", spaceId: opened.ren.state.beta.id })
      yield* opened.host.client.session
        .create({
          location: opened.host.location,
          id: Binding.LocalID.make(mine.id),
          metadata: { ren: { spaceId: mine.spaceId, sessionId: mine.id } },
        })
        .pipe(Effect.orDie)
      const own = yield* opened.rpc.listSessions({}, opened.at)
      expect(own.sessions.map((each) => [each.title, each.startedBy, each.mine, each.origin, each.local])).toEqual([
        ["Mine", "You", true, "slack", true],
      ])
      expect(own.space.name).toBe("Alpha")
      const everyone = yield* opened.rpc.listSessions({ scope: "space" }, opened.at)
      expect(everyone.sessions.map((each) => [each.id, each.startedBy, each.local])).toEqual([
        [theirs.id, "Bea", false],
        [mine.id, "You", true],
      ])
      yield* opened.rpc.listSessions(
        { scope: "space", status: "busy", origin: ["slack", "schedule"], search: " trip ", page: 2, pageSize: 10 },
        opened.at,
      )
      const asked = opened.ren.state.listed.map((query) => [...query.entries()])
      expect(asked).toEqual([
        [
          ["spaceId", opened.ren.state.spaceId],
          ["createdBy", opened.ren.state.me.id],
          ["orderBy", "updated"],
          ["page", "1"],
          ["pageSize", "50"],
        ],
        [
          ["spaceId", opened.ren.state.spaceId],
          ["orderBy", "updated"],
          ["page", "1"],
          ["pageSize", "50"],
        ],
        [
          ["spaceId", opened.ren.state.spaceId],
          ["origin", "slack"],
          ["origin", "schedule"],
          ["status", "busy"],
          ["search", "trip"],
          ["orderBy", "updated"],
          ["page", "2"],
          ["pageSize", "10"],
        ],
      ])
    }),
  ))

test("/ren:sessions opens a Ren session started elsewhere as a local copy with its ID, title, Ren model, binding, message IDs and names, reports it as a Ren session of its space, and sends nothing to Ren", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ query: "trip" })
      const session = started(opened.ren, {})
      const ren = conversation(opened.ren)
      opened.ren.state.saved.set(session.id, ren)
      yield* Effect.promise(() => RenCommands.sessions(opened.surface, { scope: "space" }))
      expect(opened.shown.at(0)?.options).toEqual([["Trip plan", "Bea · 0m ago · idle", undefined]])
      expect(opened.routes).toEqual([{ type: "session", sessionID: session.id }])
      expect(yield* opened.local(session.id)).toMatchObject({
        id: session.id,
        title: "Trip plan",
        model: { providerID: "ren", id: "stub/stub-model" },
        metadata: { ren: { spaceId: session.spaceId, sessionId: session.id } },
      })
      expect(yield* opened.rpc.sessionStatus({ sessionID: session.id }, opened.at)).toMatchObject({
        sessionID: session.id,
        ren: true,
        space: "Alpha",
      })
      const local = yield* opened.messages(session.id)
      expect(local.map((message) => String(message.id))).toEqual(ren.map((message) => message.id))
      expect(yield* opened.transcript(session.id)).toEqual([
        "user:Bea: plan the trip",
        "Reading",
        "user:thanks",
        "welcome",
        "user:Cam via Slack: book it",
        "booked",
      ])
      expect(local.at(0)).toMatchObject({
        metadata: { userID: opened.ren.state.bea.id, userName: "Bea", remote: true },
      })
      expect(local.at(3)).toMatchObject({ metadata: { userID: opened.ren.state.me.id, remote: true } })
      expect(local.at(1)).toMatchObject({
        type: "assistant",
        model: { providerID: "ren", id: "stub/stub-model" },
        content: [
          { type: "reasoning", text: "Check the notes." },
          { type: "text", text: "Reading" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: {
              status: "completed",
              input: { path: "notes.txt" },
              content: [{ type: "text", text: "the notes" }],
              metadata: { preview: "the notes", truncated: false },
            },
          },
        ],
      })

      yield* Effect.promise(() => RenCommands.sessions(opened.surface, { scope: "space" }))
      expect(opened.shown.at(1)?.options.map((option) => option[2])).toEqual(["local"])
      expect((yield* opened.messages(session.id)).length).toBe(ren.length)
      expect(opened.routes).toEqual([
        { type: "session", sessionID: session.id },
        { type: "session", sessionID: session.id },
      ])
      expect(opened.toasts).toEqual([])
      expect(opened.ren.state.prompts).toEqual([])
      expect(opened.ren.state.renames).toEqual([])
      expect(opened.ren.state.created).toEqual([])
      expect(opened.ren.state.switches).toEqual([])
      expect(yield* Queue.size(opened.ren.archived)).toBe(0)
    }),
  ))

test("a local copy that fell behind catches up by importing it again, and a prompt right after it continues the Ren session", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = started(opened.ren, {})
      const ren = conversation(opened.ren)
      opened.ren.state.saved.set(session.id, ren)
      yield* Effect.promise(() => RenCommands.open(opened.surface, session.id))
      yield* Queue.take(opened.ren.opened)
      const missed = [
        Messages.user(8, "and the hotel?", { sender: { userId: opened.ren.state.bea.id } }),
        Messages.assistant(9, [Messages.text("hotel booked")]),
      ]
      opened.ren.state.saved.set(session.id, [...ren, ...missed])
      yield* Effect.promise(() => RenCommands.catchUp(opened.surface, session.id))
      expect(yield* opened.transcript(session.id)).toEqual([
        "user:Bea: plan the trip",
        "Reading",
        "user:thanks",
        "welcome",
        "user:Cam via Slack: book it",
        "booked",
        "user:Bea: and the hotel?",
        "hotel booked",
      ])
      expect(opened.routes.at(-1)).toEqual({ type: "session", sessionID: session.id })
      yield* Queue.take(opened.ren.opened)
      const sessionID = Binding.LocalID.make(session.id)
      const delivered = yield* Queue.unbounded<string>()
      const connected = yield* Queue.unbounded<void>()
      yield* opened.host.client.event.subscribe({ types: ["session.inbox.delivered"] }).pipe(
        Stream.runForEach((event) =>
          event.type === "session.inbox.delivered"
            ? Queue.offer(delivered, event.data.inboxID)
            : Queue.offer(connected, undefined),
        ),
        Effect.forkScoped,
      )
      yield* Queue.take(connected)
      const teammate = SessionMessage.ID.create()
      opened.ren.state.messages.set(teammate, {
        id: teammate,
        type: "user",
        text: "and the train?",
        sender: { userId: opened.ren.state.bea.id },
        time: { created: DateTime.nowUnsafe() },
      })
      opened.ren.send(RenServer.frame("session.execution.started", { sessionID: session.id }))
      replying(opened.ren, "by train")({ sessionID: session.id, id: teammate, text: "", delivery: "steer" })
      expect(yield* Queue.take(delivered)).toBe(teammate)
      yield* opened.host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
      expect((yield* opened.transcript(session.id)).slice(-2)).toEqual(["user:Bea: and the train?", "by train"])
      opened.ren.state.saved.set(session.id, [
        ...ren,
        ...missed,
        Messages.user(10, "and the train?", { id: teammate, sender: { userId: opened.ren.state.bea.id } }),
        Messages.assistant(11, [Messages.text("by train")]),
      ])
      const reads = opened.ren.state.reads.length
      const kept = (yield* opened.messages(session.id)).map((message) => message.id)
      yield* Effect.promise(() => RenCommands.catchUp(opened.surface, session.id))
      expect(opened.ren.state.reads.length).toBe(reads + 1)
      expect((yield* opened.messages(session.id)).map((message) => message.id)).toEqual(kept)
      opened.ren.state.answer = replying(opened.ren, "see you there")
      const prompted = yield* opened.host.client.session.prompt({ sessionID, text: "thanks again" }).pipe(Effect.orDie)
      yield* opened.host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
      expect(opened.ren.state.prompts.map((prompt) => [prompt.id, prompt.text])).toEqual([
        [prompted.id, "thanks again"],
      ])
      expect((yield* opened.transcript(session.id)).slice(-2)).toEqual(["user:thanks again", "see you there"])
      expect(opened.ren.state.renames).toEqual([])
    }),
  ))

test("catch-up leaves a local copy alone while a local turn runs, and while it has messages Ren does not have", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const session = started(opened.ren, {})
      const ren = conversation(opened.ren)
      opened.ren.state.saved.set(session.id, ren)
      yield* Effect.promise(() => RenCommands.open(opened.surface, session.id))
      const sessionID = Binding.LocalID.make(session.id)
      opened.ren.state.answer = (prompt) => {
        opened.ren.state.delivered.add(prompt.id)
        opened.ren.send(RenServer.frame("session.inbox.delivered", { sessionID: prompt.sessionID, inboxID: prompt.id }))
      }
      const running = yield* opened.host.client.session.prompt({ sessionID, text: "a long one" }).pipe(Effect.orDie)
      yield* Queue.take(opened.ren.prompted)
      opened.ren.state.saved.set(session.id, [
        ...ren,
        Messages.user(8, "meanwhile", { sender: { userId: opened.ren.state.bea.id } }),
      ])
      expect(yield* opened.rpc.openSession({ sessionId: session.id, existing: true }, opened.at)).toEqual({
        sessionID: session.id,
        outcome: "busy",
      })
      expect((yield* opened.messages(session.id)).some((message) => message.id === running.id)).toBe(true)
      opened.ren.send(RenServer.frame("session.execution.succeeded", { sessionID: session.id }))
      yield* opened.host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
      opened.ren.state.saved.set(session.id, [
        ...ren,
        Messages.user(8, "a long one", { id: SessionMessage.ID.make(running.id) }),
        Messages.user(9, "meanwhile", { sender: { userId: opened.ren.state.bea.id } }),
      ])

      opened.ren.state.refusing = true
      const unsent = yield* opened.host.client.session.prompt({ sessionID, text: "not sent" }).pipe(Effect.orDie)
      yield* opened.host.client.experimental.session.wait({ sessionID }).pipe(Effect.orDie)
      opened.ren.state.refusing = false
      yield* Effect.promise(() => RenCommands.catchUp(opened.surface, session.id))
      expect((yield* opened.messages(session.id)).some((message) => message.id === unsent.id)).toBe(true)
      expect(opened.toasts.map((toast) => toast.variant)).toEqual(["warning"])

      opened.ren.state.saved.set(session.id, [
        ...ren,
        Messages.user(8, "a long one", { id: SessionMessage.ID.make(running.id) }),
        Messages.user(9, "meanwhile", { sender: { userId: opened.ren.state.bea.id } }),
        Messages.user(10, "not sent", { id: SessionMessage.ID.make(unsent.id) }),
        Messages.user(11, "later", { sender: { userId: opened.ren.state.bea.id } }),
      ])
      yield* opened.host.client.session.prompt({ sessionID, text: "queued", resume: false }).pipe(Effect.orDie)
      yield* Effect.promise(() => RenCommands.catchUp(opened.surface, session.id))
      expect(yield* opened.host.client.session.inbox.list({ sessionID }).pipe(Effect.orDie)).toMatchObject([
        { payload: { text: "queued" } },
      ])
      expect(opened.toasts.map((toast) => toast.variant)).toEqual(["warning", "warning"])
    }),
  ))
