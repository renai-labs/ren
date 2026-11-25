import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { DialogAlertOptions, DialogSelectOptions, Route, ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionMessage } from "@ren/schema/session/message"
import { Task } from "@ren/schema/task"
import { DateTime, Effect, type Scope } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { Info } from "../src/info.js"
import { RenRpc } from "../src/rpc.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* (options: { readonly appUrl?: string; readonly opener?: boolean } = {}) {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({
    plugins: [{ package: plugin, options: { url: ren.url, ...(options.appUrl && { appUrl: options.appUrl }) } }],
  })
  const rpc = host.client.rpc(RenRpc.Definition)
  const at = { location: host.location }
  const created = yield* rpc.createSession({}, at)
  const sessionID = created.sessionID
  const toasts: Array<ToastOptions> = []
  const alerts: Array<DialogAlertOptions> = []
  const selects: Array<ReadonlyArray<readonly [string, unknown, unknown]>> = []
  const opened: Array<string> = []
  const route: { current: Route } = { current: { type: "session", sessionID } }
  const pick = { index: 0 }
  const surface: RenCommands.InfoSurface = {
    client: host.promise,
    location: () => host.location,
    open: (url) => {
      opened.push(url)
      return options.opener ?? true
    },
    ui: {
      dialog: {
        select: <Value>(dialog: DialogSelectOptions<Value>) => {
          selects.push(dialog.options.map((option) => [option.title, option.description, option.category] as const))
          return Promise.resolve(dialog.options.at(pick.index)?.value)
        },
        confirm: () => Promise.resolve(false),
        alert: (dialog) => {
          alerts.push(dialog)
          return Promise.resolve()
        },
      },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: () => undefined, current: () => route.current },
      model: { current: () => undefined },
    },
  }
  const bind = Effect.fnUntraced(function* (fields: Partial<Session.Info> = {}) {
    yield* host.client.session
      .update({
        sessionID: Binding.LocalID.make(sessionID),
        metadata: { ren: { spaceId: created.spaceId, sessionId: sessionID } },
      })
      .pipe(Effect.orDie)
    ren.state.sessions.push({
      id: Session.ID.make(sessionID),
      spaceId: created.spaceId,
      createdBy: ren.state.bea.id,
      agentId: null,
      origin: "chat",
      harness: "opencode",
      title: "Fix login",
      status: "idle",
      capabilities: SessionCapabilities.of("opencode"),
      createdAt: DateTime.nowUnsafe(),
      updatedAt: DateTime.nowUnsafe(),
      archivedAt: null,
      filesResetAt: null,
      ...fields,
    })
  })
  const info = rpc.sessionInfo({ sessionID }, at)
  return { ren, host, rpc, at, sessionID, created, surface, toasts, alerts, selects, opened, route, pick, bind, info }
})

const tokens = (input: number) => ({ input, output: 10, reasoning: 0, cache: { read: 5, write: 0 } })

test("a Ren session's info has its space, who started it and where, its links with the pull requests' state, the context of its newest step and Ren's cost, read from Ren's API without opening a link", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.bind({ origin: "slack" })
      const id = opened.sessionID
      const taskId = Task.ID.create()
      opened.ren.state.links.set(id, {
        tasks: [{ id: taskId, identifier: "REN-12", title: "Fix the login loop", status: "in_progress" }],
        pullRequests: [
          { url: "https://github.com/acme/web/pull/45", number: 45 },
          { url: "https://github.com/acme/api/pull/7", number: 7 },
        ],
        issues: [
          { kind: "github_issue", url: "https://github.com/acme/web/issues/3" },
          { kind: "linear_issue", url: "https://linear.app/acme/issue/ENG-9/login" },
        ],
        threads: [{ provider: "slack", url: "https://acme.slack.com/archives/C1/p1", place: "web-team" }],
      })
      opened.ren.state.pulls.set(id, [
        { url: "https://github.com/acme/web/pull/45", number: 45, title: "Fix the loop", state: "merged" },
        { url: "https://github.com/acme/api/pull/7", number: 7, title: null, state: null },
      ])
      opened.ren.state.usage.set(id, {
        total: 420_000,
        models: 400_000,
        tools: 20_000,
        currency: "usd",
        source: "billed",
      })
      const model = { providerID: "stub", id: "stub-model" }
      const created = { created: DateTime.nowUnsafe() }
      opened.ren.state.saved.set(id, [
        {
          id: SessionMessage.ID.create(),
          type: "assistant",
          agent: "build",
          model,
          content: [],
          tokens: tokens(9_000),
          time: created,
        },
        {
          id: SessionMessage.ID.create(),
          type: "compaction",
          status: "completed",
          reason: "manual",
          summary: "s",
          recent: "",
          time: created,
        },
        {
          id: SessionMessage.ID.create(),
          type: "assistant",
          agent: "build",
          model,
          content: [],
          tokens: tokens(1_200),
          time: created,
        },
        { id: SessionMessage.ID.create(), type: "assistant", agent: "build", model, content: [], time: created },
      ])

      const info = yield* opened.info
      const app = new URL(opened.ren.url).origin
      expect(info).toMatchObject({
        sessionID: id,
        ren: true,
        created: true,
        app,
        url: `${app}/sessions/${id}`,
        space: { id: opened.created.spaceId, name: "Alpha", slug: "alpha" },
        startedBy: "Bea",
        origin: "slack",
        context: 1_215,
        cost: { total: 420_000, models: 400_000, tools: 20_000 },
      })
      expect(RenCommands.about(info)).toEqual({
        started: "by Bea · Slack",
        context: "1,215 tokens",
        cost: "$0.42 · LLM $0.40 · tools $0.02",
      })
      expect(RenCommands.linkRows(info).map((row) => [row.group, row.title, row.detail, row.url])).toEqual([
        ["Tasks", "REN-12 Fix the login loop", "in progress", `${app}/tasks/${taskId}`],
        ["Pull requests", "Fix the loop", "#45 · merged", "https://github.com/acme/web/pull/45"],
        ["Pull requests", "acme/api", "#7", "https://github.com/acme/api/pull/7"],
        ["Issues", "acme/web", "#3", "https://github.com/acme/web/issues/3"],
        ["Issues", "ENG-9", "Linear", "https://linear.app/acme/issue/ENG-9/login"],
        ["Threads", "#web-team", "Slack", "https://acme.slack.com/archives/C1/p1"],
      ])
      expect(opened.ren.state.accessed).toEqual([])
    }),
  ))

test("/ren:open opens the Ren session in the web app, and /ren:links lists its links and opens the chosen one", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      yield* opened.bind()
      opened.ren.state.links.set(opened.sessionID, {
        tasks: [],
        pullRequests: [],
        issues: [{ kind: "github_issue", url: "https://github.com/acme/web/issues/3" }],
        threads: [{ provider: "github", url: "https://github.com/acme/web/pull/1#c", place: null }],
      })
      yield* Effect.promise(() => RenCommands.openWeb(opened.surface))
      opened.pick.index = 1
      yield* Effect.promise(() => RenCommands.links(opened.surface))
      expect(opened.selects).toEqual([
        [
          ["acme/web", "#3", "Issues"],
          ["GitHub thread", "GitHub", "Threads"],
        ],
      ])
      expect(opened.opened).toEqual([
        `${new URL(opened.ren.url).origin}/sessions/${opened.sessionID}`,
        "https://github.com/acme/web/pull/1#c",
      ])
      expect([opened.toasts, opened.alerts, opened.ren.state.accessed]).toEqual([[], [], []])
    }),
  ))

test("without a browser opener, /ren:open shows the address; with the appUrl option it uses that web app", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup({ appUrl: "https://ren.example.com/", opener: false })
      yield* opened.bind()
      yield* Effect.promise(() => RenCommands.openWeb(opened.surface))
      const url = `https://ren.example.com/sessions/${opened.sessionID}`
      expect(opened.opened).toEqual([url])
      expect(opened.alerts).toEqual([{ title: "Open in Ren", message: `Open this address in your browser:\n${url}` }])
    }),
  ))

test("a session from /ren:new that is not on Ren yet has its space, and /ren:open opens the space and says why", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const app = new URL(opened.ren.url).origin
      expect(yield* opened.info).toMatchObject({
        ren: true,
        created: false,
        url: `${app}/spaces/${opened.created.spaceId}`,
        space: { name: "Alpha" },
        startedBy: null,
        context: null,
        cost: null,
      })
      yield* Effect.promise(() => RenCommands.openWeb(opened.surface))
      yield* Effect.promise(() => RenCommands.links(opened.surface))
      expect(opened.opened).toEqual([`${app}/spaces/${opened.created.spaceId}`])
      expect(opened.toasts.map((toast) => toast.message)).toEqual([
        "This session starts on Ren with its first prompt, so its space Alpha opens instead.",
        "This Ren session has no tasks, pull requests, issues or threads yet.",
      ])
    }),
  ))

test("a session that is not a Ren session has no Ren info, and /ren:open and /ren:links say so", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const local = yield* opened.host.client.session.create({ location: opened.host.location }).pipe(Effect.orDie)
      expect(yield* opened.rpc.sessionInfo({ sessionID: local.id }, opened.at)).toMatchObject({
        ren: false,
        url: null,
        space: null,
      })
      opened.route.current = { type: "session", sessionID: local.id }
      yield* Effect.promise(() => RenCommands.openWeb(opened.surface))
      yield* Effect.promise(() => RenCommands.links(opened.surface))
      expect(opened.opened).toEqual([])
      expect(opened.toasts.map((toast) => toast.message)).toEqual([
        "This is not a Ren session.",
        "This is not a Ren session.",
      ])
    }),
  ))

test("the web app's address follows from the server's: production drops api., local development moves to the app's port, another server keeps its origin, and the appUrl option wins", () => {
  expect(Info.webApp(new URL("https://api.useren.ai"), undefined)).toBe("https://useren.ai")
  expect(Info.webApp(new URL("http://localhost:4000/"), undefined)).toBe("http://localhost:5173")
  expect(Info.webApp(new URL("https://ren.acme.internal/"), undefined)).toBe("https://ren.acme.internal")
  expect(Info.webApp(new URL("https://api.useren.ai"), "https://staging.useren.ai/")).toBe("https://staging.useren.ai")
})
