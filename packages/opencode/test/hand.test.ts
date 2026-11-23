import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { ToastOptions } from "@opencode/plugin/tui/context"
import { OpenCodeHost } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { DateTime, Effect, Queue, type Scope, Struct } from "effect"
import { Binding } from "../src/binding.js"
import { RenCommands } from "../src/commands.js"
import { Hand } from "../src/hand.js"
import { RenPanels } from "../src/panels.js"
import { RenRpc } from "../src/rpc.js"
import { Messages } from "./lib/messages.js"
import { RenServer } from "./lib/ren.js"

const plugin = fileURLToPath(new URL("..", import.meta.url))

process.env["REN_TOKEN"] = "user-token"

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => body.pipe(Effect.scoped, Effect.runPromise)

const setup = Effect.fnUntraced(function* () {
  const ren = yield* RenServer.make()
  const host = yield* OpenCodeHost.make({ plugins: [{ package: plugin, options: { url: ren.url } }] })
  const created = yield* host.client.rpc(RenRpc.Definition).createSession({}, { location: host.location })
  const sessionID = created.sessionID
  yield* host.client.session
    .update({
      sessionID: Binding.LocalID.make(sessionID),
      metadata: { ren: { spaceId: created.spaceId, sessionId: sessionID } },
    })
    .pipe(Effect.orDie)
  const toasts: Array<ToastOptions> = []
  const opened: Array<string> = []
  const route = { sessionID }
  const surface: RenCommands.PanelSurface = {
    client: host.promise,
    location: () => host.location,
    ui: {
      dialog: { select: () => Promise.resolve(undefined), confirm: () => Promise.resolve(false) },
      toast: { show: (toast) => toasts.push(toast) },
      router: { navigate: () => undefined, current: () => ({ type: "session", sessionID: route.sessionID }) },
      model: { current: () => undefined },
      panel: { open: (name) => Boolean(opened.push(name)) },
    },
  }
  return { ren, host, sessionID, surface, toasts, opened, route }
})

const ready = <A>(loaded: RenPanels.Loaded<A>) => {
  if (loaded.type === "failed") throw new Error(loaded.message)
  return loaded.value
}

const diff = (file: string, patch: string) => ({ file, patch, additions: 1, deletions: 0, status: "modified" as const })

test("/ren:diff opens the changes of the hand: each repository's changed files with their counts and patches, by mode, and a large patch is cut", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const hand = opened.ren.state.hand
      hand.projects.push({ path: "", branch: "main" }, { path: "web/", branch: "feature" })
      hand.diffs.set(":working", [diff("a.ts", "@@ -1 +1 @@\n-a\n+b\n")])
      hand.diffs.set("web/:branch", [diff("big.txt", "+line\n".repeat(20_000)), diff("b.ts", "+b\n")])
      expect(yield* Effect.promise(() => RenCommands.files(opened.surface, RenCommands.panels.changes))).toBe(true)
      expect(opened.opened).toEqual(["ren.changes"])
      const first = ready(
        yield* Effect.promise(() => RenPanels.changes(opened.surface, { sessionID: opened.sessionID })),
      )
      expect(first).toEqual({
        projects: [
          { path: "", branch: "main" },
          { path: "web/", branch: "feature" },
        ],
        path: "",
        mode: "working",
        repository: true,
        branch: { current: "main", default: "main" },
        files: [{ ...diff("a.ts", "@@ -1 +1 @@\n-a\n+b\n"), truncated: false }],
      })
      const web = ready(
        yield* Effect.promise(() =>
          RenPanels.changes(opened.surface, { sessionID: opened.sessionID, path: "web/", mode: "branch" }),
        ),
      )
      expect(web.files.map((file) => [file.file, file.truncated])).toEqual([
        ["big.txt", true],
        ["b.ts", false],
      ])
      expect(web.files[0]?.patch.length).toBeLessThanOrEqual(Hand.patchLimit)
      expect(web.files[0]?.patch.endsWith("+line\n")).toBe(true)
      expect(opened.toasts).toEqual([])
    }),
  ))

test("/ren:files lists a folder of the hand with folders first, reads a file, and cuts a large file and says so", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const tree = opened.ren.state.hand.tree
      tree.set("src/a.ts", "export const a = 1\n")
      tree.set("README.md", "# Hello\n")
      tree.set("big.txt", "a line of text\n".repeat(20_000))
      const sessionID = opened.sessionID
      expect(yield* Effect.promise(() => RenCommands.files(opened.surface, RenCommands.panels.files))).toBe(true)
      expect(opened.opened).toEqual(["ren.files"])
      const root = ready(yield* Effect.promise(() => RenPanels.list(opened.surface, { sessionID })))
      expect(root.entries.map((entry) => entry.path)).toEqual(["src/", "README.md", "big.txt"])
      const src = ready(yield* Effect.promise(() => RenPanels.list(opened.surface, { sessionID, path: "src/" })))
      expect(src.entries).toEqual([{ path: "src/a.ts", type: "file", size: 19 }])
      expect(
        ready(yield* Effect.promise(() => RenPanels.read(opened.surface, { sessionID, path: "src/a.ts" }))),
      ).toEqual({ path: "src/a.ts", size: 19, binary: false, content: "export const a = 1\n", truncated: false })
      const big = ready(yield* Effect.promise(() => RenPanels.read(opened.surface, { sessionID, path: "big.txt" })))
      expect(big.truncated).toBe(true)
      expect(big.size).toBe(300_000)
      expect(big.content.length).toBeLessThanOrEqual(Hand.fileLimit)
      expect(big.content.endsWith("a line of text\n")).toBe(true)
      const found = ready(yield* Effect.promise(() => RenPanels.search(opened.surface, { sessionID, query: "a.ts" })))
      expect(found.entries.map((entry) => entry.path)).toEqual(["src/a.ts"])
    }),
  ))

test("/ren:shell runs a command on the hand, its output is read by cursor until it exits, and a running command stops", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const sessionID = opened.sessionID
      const started = yield* Effect.promise(() => RenCommands.shell(opened.surface, " make test "))
      expect(started).toMatchObject({ command: "make test", status: "running", sessionID })
      expect(opened.opened).toEqual(["ren.shells"])
      const shellID = started?.id ?? ""
      opened.ren.shell.write(shellID, "\u001b[32mone\u001b[0m\r\n")
      const first = ready(
        yield* Effect.promise(() => RenPanels.output(opened.surface, { sessionID, shellID, cursor: 0 })),
      )
      expect([first.output, first.cursor, first.shell.status, RenPanels.ended(first)]).toEqual([
        "one\n",
        14,
        "running",
        false,
      ])
      opened.ren.shell.write(shellID, "two\n")
      opened.ren.shell.exit(shellID, 2)
      const last = ready(
        yield* Effect.promise(() => RenPanels.output(opened.surface, { sessionID, shellID, cursor: first.cursor })),
      )
      expect([last.output, RenPanels.status(last.shell), RenPanels.ended(last)]).toEqual(["two\n", "exited 2", true])

      const other = yield* Effect.promise(() => RenCommands.shell(opened.surface, "sleep 60"))
      const listed = ready(yield* Effect.promise(() => RenPanels.shells(opened.surface, { sessionID })))
      expect(listed.shells.map((shell) => shell.command)).toEqual(["sleep 60"])
      ready(yield* Effect.promise(() => RenPanels.stop(opened.surface, { sessionID, shellID: other?.id ?? "" })))
      expect(ready(yield* Effect.promise(() => RenPanels.shells(opened.surface, { sessionID }))).shells).toEqual([])
    }),
  ))

test("a hand without files or shell refuses the panels with a reason and opens none", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      opened.ren.state.hand.files = false
      opened.ren.state.hand.shell = false
      expect(yield* Effect.promise(() => RenCommands.files(opened.surface, RenCommands.panels.changes))).toBe(false)
      expect(yield* Effect.promise(() => RenCommands.shell(opened.surface, "ls"))).toBeUndefined()
      expect(opened.opened).toEqual([])
      expect(opened.toasts).toEqual([
        { title: "Ren", message: "This Ren session cannot show the files of its hand.", variant: "error" },
        { title: "Ren", message: "This Ren session cannot run commands on its hand.", variant: "error" },
      ])
      expect(opened.ren.state.hand.shells.size).toBe(0)
    }),
  ))

test("a local session that is not a Ren session gets not_ren, and the commands say so", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const local = yield* opened.host.client.session.create({}).pipe(Effect.orDie)
      opened.route.sessionID = local.id
      const refused = yield* Effect.promise(() =>
        opened.host.promise
          .rpc(RenRpc.Definition)
          .listFiles({ sessionID: local.id }, { location: opened.host.location })
          .then(
            () => undefined,
            (error: unknown) => error,
          ),
      )
      expect(refused).toMatchObject({ type: "not_ren", message: "This is not a Ren session." })
      expect(yield* Effect.promise(() => RenCommands.files(opened.surface, RenCommands.panels.files))).toBe(false)
      expect(opened.toasts).toEqual([{ title: "Ren", message: "This is not a Ren session.", variant: "error" }])
      expect(opened.opened).toEqual([])
    }),
  ))

test("each call opens the session's link for itself and lets it go, so an idle panel keeps no brain awake", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const sessionID = opened.sessionID
      ready(yield* Effect.promise(() => RenPanels.list(opened.surface, { sessionID })))
      expect(yield* Queue.take(opened.ren.accessed)).toBe(sessionID)
      ready(yield* Effect.promise(() => RenPanels.list(opened.surface, { sessionID })))
      expect(yield* Queue.take(opened.ren.accessed)).toBe(sessionID)
    }),
  ))

const running = (id: string, name: string, input: Record<string, string>, metadata: Record<string, string>) => ({
  type: "tool" as const,
  id,
  name,
  executed: true,
  state: { status: "running" as const, input, metadata },
  time: { created: DateTime.nowUnsafe() },
})

const blocked = (opened: Effect.Success<ReturnType<typeof setup>>, shellID: string, childID: string) => {
  const turn = Messages.assistant(1, [
    running("call_shell", "shell", { command: "sleep 60" }, { shellID }),
    running("call_agent", "subagent", { description: "Look", agent: "general" }, { sessionID: childID }),
  ])
  opened.ren.state.saved.set(opened.sessionID, [
    Messages.user(0, "go"),
    Struct.assign(turn, { time: { created: turn.time.created } }),
  ])
}

test("/ren:background moves the shell and subagent the turn waits for to the background and names them; with nothing blocking it says so and moves nothing", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const shell = yield* Effect.promise(() => RenCommands.shell(opened.surface, "sleep 60"))
      blocked(opened, shell?.id ?? "", Session.ID.create())
      yield* Effect.promise(() => RenCommands.background(opened.surface))
      expect(yield* Queue.take(opened.ren.backgrounded)).toBe(opened.sessionID)
      expect(opened.toasts).toEqual([
        { title: "Ren", message: "Moved to the background: sleep 60, Look. The turn goes on.", variant: "success" },
      ])
      opened.ren.state.saved.set(opened.sessionID, [Messages.user(0, "go"), Messages.assistant(1, [])])
      yield* Effect.promise(() => RenCommands.background(opened.surface))
      expect(opened.toasts.at(-1)).toEqual({
        title: "Ren",
        message: "Nothing blocks this Ren session’s turn.",
        variant: "info",
      })
      expect(yield* Queue.size(opened.ren.backgrounded)).toBe(0)
    }),
  ))

test("/ren:activity lists the running shells and subagents, the ones the turn waits for first, and stops each", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const sessionID = opened.sessionID
      const waited = yield* Effect.promise(() => RenCommands.shell(opened.surface, "sleep 60"))
      const other = yield* Effect.promise(() => RenCommands.shell(opened.surface, "tail -f log"))
      const look = Session.ID.create()
      const check = Session.ID.create()
      const done = Session.ID.create()
      opened.ren.state.children.push(look, check, done)
      opened.ren.state.titles.set(look, "Look (@general subagent)")
      opened.ren.state.titles.set(check, "Check (@explore subagent)")
      opened.ren.state.busy.add(sessionID).add(look).add(check)
      blocked(opened, waited?.id ?? "", look)
      expect(yield* Effect.promise(() => RenCommands.activity(opened.surface))).toBe(true)
      expect(opened.opened.at(-1)).toBe("ren.activity")
      const listed = ready(yield* Effect.promise(() => RenPanels.activity(opened.surface, { sessionID })))
      expect(listed.items).toEqual([
        { type: "shell", id: waited?.id ?? "", sessionID, label: "sleep 60", blocking: true },
        { type: "subagent", id: look, sessionID: look, label: "Look", blocking: true },
        { type: "shell", id: other?.id ?? "", sessionID, label: "tail -f log", blocking: false },
        { type: "subagent", id: check, sessionID: check, label: "Check", blocking: false },
      ])
      ready(yield* Effect.promise(() => RenPanels.stopSubagent(opened.surface, { sessionID, childID: check })))
      expect(yield* Queue.take(opened.ren.interrupted)).toBe(check)
      ready(yield* Effect.promise(() => RenPanels.stop(opened.surface, { sessionID, shellID: other?.id ?? "" })))
      opened.ren.state.saved.set(sessionID, [])
      expect(
        ready(yield* Effect.promise(() => RenPanels.activity(opened.surface, { sessionID }))).items.map(
          (item) => item.label,
        ),
      ).toEqual(["sleep 60", "Look"])
    }),
  ))

test("activity on a hand without the shell lists only subagents, a session that cannot interrupt refuses to stop one, and a local session gets not_ren", () =>
  run(
    Effect.gen(function* () {
      const opened = yield* setup()
      const sessionID = opened.sessionID
      yield* Effect.promise(() => RenCommands.shell(opened.surface, "sleep 60"))
      const look = Session.ID.create()
      opened.ren.state.children.push(look)
      opened.ren.state.busy.add(look)
      opened.ren.state.hand.shell = false
      opened.ren.state.interruptible = false
      expect(
        ready(yield* Effect.promise(() => RenPanels.activity(opened.surface, { sessionID }))).items.map(
          (item) => item.type,
        ),
      ).toEqual(["subagent"])
      expect(yield* Effect.promise(() => RenPanels.stopSubagent(opened.surface, { sessionID, childID: look }))).toEqual(
        { type: "failed", message: "This Ren session cannot stop its subagents.", signedOut: false },
      )
      expect(yield* Queue.size(opened.ren.interrupted)).toBe(0)

      const local = yield* opened.host.client.session.create({}).pipe(Effect.orDie)
      opened.route.sessionID = local.id
      expect(yield* Effect.promise(() => RenCommands.activity(opened.surface))).toBe(false)
      yield* Effect.promise(() => RenCommands.background(opened.surface))
      expect(opened.toasts).toEqual([
        { title: "Ren", message: "This is not a Ren session.", variant: "error" },
        { title: "Ren", message: "This is not a Ren session.", variant: "error" },
      ])
      expect(opened.opened).toEqual(["ren.shells"])
    }),
  ))
