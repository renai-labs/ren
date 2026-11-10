export * as ChatAtoms from "./atoms.js"

import type { Browser } from "@ren/schema/browser"
import type { Session } from "@ren/schema/session"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionVcs } from "@ren/schema/session/vcs"
import type { Shell } from "@ren/schema/shell"
import { Effect, Option, Queue, Stream, SubscriptionRef } from "effect"
import type { HttpClient } from "effect/http"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { ChatSession } from "./chat-session.js"
import { ChatState } from "./chat-state.js"
import { Family } from "./family.js"
import { Projection } from "./projection.js"
import { ShellOutput } from "./shell-output.js"
import type { TimelineDetail } from "./timeline-detail.js"

export type Lifecycle = "foreground" | "online"

export interface View {
  readonly root: Session.ID
  readonly sessionID: Session.ID
}

export interface FileQuery {
  readonly root: Session.ID
  readonly query: string
  readonly type?: SessionCatalog.FileType
}

export interface PathView {
  readonly root: Session.ID
  readonly path: string
}

export interface ShellView extends View {
  readonly shellID: Shell.ID
  readonly running: boolean
}

export type BrowserView =
  | { readonly status: "none" }
  | { readonly status: "closed" }
  | { readonly status: "connecting" | "live" | "failed"; readonly info: Browser.Info }

export interface Options<R, ER> {
  readonly runtime: Atom.AtomRuntime<R | HttpClient.HttpClient, ER>
  readonly access: (
    sessionID: Session.ID,
    input: { readonly unreachable: boolean },
  ) => Effect.Effect<Session.ClientAccess, unknown, R>
  readonly saved?: (
    sessionID: Session.ID,
    query: { readonly limit: number },
  ) => Effect.Effect<SessionMessage.Page, unknown, R>
  readonly outbox?: (sessionID: Session.ID) => NonNullable<ChatSession.Options["outbox"]>
  readonly sender?: SessionMessage.Sender
  readonly detail?: TimelineDetail.Detail
  readonly lifecycle?: (listener: (event: Lifecycle) => void) => () => void
}

export const handoffLimit = 40

export const make = <R, ER>(options: Options<R, ER>) => {
  const handoffs = new Map<Session.ID, ChatSession.Handoff>()

  const handoff = (sessionID: Session.ID, prompt: ChatSession.Handoff) => {
    handoffs.delete(sessionID)
    handoffs.set(sessionID, prompt)
    const oldest = [...handoffs.keys()].slice(0, Math.max(0, handoffs.size - handoffLimit))
    for (const key of oldest) handoffs.delete(key)
  }

  const attentions = new Map<Session.ID, Family.Attention>()
  const watchers = new Set<() => void>()

  const publish = (sessionID: Session.ID, value: Family.Attention | undefined) => {
    if (value) attentions.set(sessionID, value)
    else attentions.delete(sessionID)
    for (const watcher of watchers) watcher()
  }

  const attention = {
    read: (sessionID: Session.ID) => attentions.get(sessionID),
    subscribe: (watcher: () => void) => {
      watchers.add(watcher)
      return () => void watchers.delete(watcher)
    },
  }

  const session = Atom.family((sessionID: Session.ID) =>
    options.runtime
      .atom(
        Effect.gen(function* () {
          const context = yield* Effect.context<R>()
          const handed = handoffs.get(sessionID)
          const saved = options.saved
          handoffs.delete(sessionID)
          const opened = yield* ChatSession.make({
            sessionID,
            access: (input) => options.access(sessionID, input).pipe(Effect.provide(context)),
            ...(saved && {
              saved: (query: { readonly limit: number }) => saved(sessionID, query).pipe(Effect.provide(context)),
            }),
            ...(options.sender && { sender: options.sender }),
            ...(handed && { handoff: handed }),
            ...(options.outbox && { outbox: options.outbox(sessionID) }),
          })
          yield* opened.open(sessionID).pipe(
            Effect.andThen(opened.enrich(sessionID)),
            Effect.catch((error) => Effect.logWarning("The chat could not load the session", error)),
            Effect.forkScoped,
          )
          yield* Effect.addFinalizer(() => Effect.sync(() => publish(sessionID, undefined)))
          yield* SubscriptionRef.changes(opened.state).pipe(
            Stream.map((current) => Family.attention(current, sessionID)),
            Stream.changes,
            Stream.runForEach((value) => Effect.sync(() => publish(sessionID, value))),
            Effect.forkScoped,
          )
          const lifecycle = options.lifecycle
          if (lifecycle)
            yield* Stream.callback<Lifecycle>((queue) =>
              Effect.acquireRelease(
                Effect.sync(() => lifecycle((event) => Queue.offerUnsafe(queue, event))),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ).pipe(
              Stream.runForEach((event) =>
                event === "online"
                  ? opened.wake.pipe(Effect.andThen(opened.resync("The network connection is back")))
                  : opened.foreground,
              ),
              Effect.forkScoped,
            )
          return opened
        }),
      )
      .pipe(Atom.setIdleTTL("1 minute")),
  )

  const watch = <A>(
    sessionID: Session.ID,
    select: (opened: ChatSession.ChatSession) => SubscriptionRef.SubscriptionRef<A>,
  ) =>
    Atom.make((get) =>
      Stream.unwrap(Effect.map(get.result(session(sessionID)), (opened) => SubscriptionRef.changes(select(opened)))),
    )

  const state = Atom.family((sessionID: Session.ID) => watch(sessionID, (opened) => opened.state))

  const status = Atom.family((sessionID: Session.ID) => watch(sessionID, (opened) => opened.status))

  const boot = Atom.family((sessionID: Session.ID) => watch(sessionID, (opened) => opened.boot))

  const project = (get: Atom.AtomContext, view: View) =>
    AsyncResult.map(get(state(view.root)), (current): Projection.Projection => {
      const previous = Option.flatMap(get.self<AsyncResult.AsyncResult<Projection.Projection>>(), AsyncResult.value)
      return Projection.project({
        messages: ChatState.visible(current, view.sessionID),
        busy: ChatState.activity(current, view.sessionID) === "running",
        pendingInputIDs: new Set(ChatState.inputs(current, view.sessionID)),
        queuedCompactionIDs: ChatState.pending(current, view.sessionID).flatMap((item) =>
          item.type === "compaction" ? [item.id] : [],
        ),
        ...(options.detail && { detail: options.detail }),
        ...(Option.isSome(previous) && { previous: previous.value.rows }),
      })
    })

  const timeline = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) => project(get, { root: sessionID, sessionID })),
  )

  const reader = Atom.family((view: View) =>
    Atom.make((get) =>
      Effect.flatMap(get.result(session(view.root)), (opened) =>
        opened.open(view.sessionID).pipe(Effect.andThen(opened.enrich(view.sessionID))),
      ),
    ),
  )

  const child = Atom.family((view: View) =>
    Atom.make((get) => {
      get.mount(reader(view))
      return project(get, view)
    }),
  )

  const run = <A, E>(
    registry: AtomRegistry.AtomRegistry,
    sessionID: Session.ID,
    action: (opened: ChatSession.ChatSession) => Effect.Effect<A, E>,
  ) => Effect.flatMap(AtomRegistry.getResult(registry, session(sessionID), { suspendOnWaiting: true }), action)

  const models = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) => {
      const connection = get(status(sessionID))
      const previous = Option.flatMap(
        get.self<AsyncResult.AsyncResult<Effect.Success<ChatSession.ChatSession["models"]>, unknown>>(),
        AsyncResult.value,
      )
      if (Option.isSome(previous) && !(AsyncResult.isSuccess(connection) && connection.value === "connected"))
        return Effect.succeed(previous.value)
      return Effect.flatMap(get.result(session(sessionID)), (opened) => opened.models)
    }),
  )

  const agents = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) => Effect.flatMap(get.result(session(sessionID)), (opened) => opened.agents)),
  )

  const skills = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) => Effect.flatMap(get.result(session(sessionID)), (opened) => opened.skills)),
  )

  const commands = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) => Effect.flatMap(get.result(session(sessionID)), (opened) => opened.commands)),
  )

  const files = Atom.family((search: FileQuery) =>
    Atom.make((get) =>
      search.query
        ? Effect.flatMap(get.result(session(search.root)), (opened) => opened.searchFiles(search.query, search.type))
        : Effect.succeed([]),
    ),
  )

  const running = Atom.family((root: Session.ID) =>
    Atom.make((get) =>
      Option.match(AsyncResult.value(get(state(root))), {
        onNone: () => false,
        onSome: (current) => ChatState.activity(current, root) === "running",
      }),
    ),
  )

  const workspace = <A, E>(root: Session.ID, read: (opened: ChatSession.ChatSession) => Effect.Effect<A, E>) =>
    Atom.make((get) => {
      get(running(root))
      return Effect.flatMap(get.result(session(root)), read)
    })

  const folder = Atom.family((view: PathView) => workspace(view.root, (opened) => opened.listFiles(view.path)))

  const file = Atom.family((view: PathView) => workspace(view.root, (opened) => opened.readFile(view.path)))

  const vcs = Atom.family((root: Session.ID) => workspace(root, (opened) => opened.vcs))

  const vcsDiff = Atom.family((view: { readonly root: Session.ID; readonly mode: SessionVcs.Mode }) =>
    workspace(view.root, (opened) => opened.vcsDiff(view.mode)),
  )

  const runningShells = Atom.family((root: Session.ID) =>
    Atom.make((get) =>
      Option.match(AsyncResult.value(get(state(root))), {
        onNone: () => undefined,
        onSome: (current) => current.shells,
      }),
    ),
  )

  const openedBrowser = Atom.family((root: Session.ID) =>
    Atom.make((get) =>
      Option.match(AsyncResult.value(get(state(root))), {
        onNone: () => undefined,
        onSome: (current) => current.browser,
      }),
    ),
  )

  // oxlint-disable-next-line ren/no-comments -- Following the browser keeps it running, so only a mounted view follows it. When the stream ends, a read tells a closed browser from a lost connection.
  const browser = Atom.family((root: Session.ID) =>
    Atom.make((get) => {
      if (get(openedBrowser(root))?.closed) return Stream.succeed<BrowserView>({ status: "closed" })
      return Stream.unwrap(
        Effect.map(get.result(session(root)), (opened) => {
          const ended = opened.browser.pipe(
            Effect.map((info): BrowserView => ({ status: "failed", info })),
            Effect.catchTag("NotFoundError", () => Effect.succeed<BrowserView>({ status: "closed" })),
          )
          return Stream.unwrap(
            opened.browser.pipe(
              Effect.map((info) =>
                Stream.succeed<BrowserView>({ status: "connecting", info }).pipe(
                  Stream.concat(
                    opened.watchBrowser.pipe(
                      Stream.map((next): BrowserView => ({ status: "live", info: next })),
                      Stream.catch(() => Stream.empty),
                    ),
                  ),
                  Stream.concat(Stream.fromEffect(ended)),
                ),
              ),
              Effect.catchTag("NotFoundError", () => Effect.succeed(Stream.succeed<BrowserView>({ status: "none" }))),
            ),
          )
        }),
      )
    }),
  )

  const webSearchProviders = Atom.family((view: View) =>
    Atom.make((get) =>
      Effect.flatMap(get.result(session(view.root)), (opened) => opened.webSearchProviders(view.sessionID)),
    ),
  )

  const shellRunning = Atom.family((view: { readonly root: Session.ID; readonly shellID: Shell.ID }) =>
    Atom.make((get) =>
      Option.match(AsyncResult.value(get(state(view.root))), {
        onNone: () => false,
        onSome: (current) => ChatState.shellRunning(current, view.shellID),
      }),
    ),
  )

  const shell = Atom.family((view: Omit<ShellView, "running">) =>
    Atom.make((get) => {
      get(runningShells(view.root))
      return Effect.flatMap(get.result(session(view.root)), (opened) => opened.shell(view.sessionID, view.shellID))
    }),
  )

  const shells = ShellOutput.make()

  const shellOutput = Atom.family((view: ShellView) =>
    Atom.make((get) => {
      const running = view.running || get(shellRunning({ root: view.root, shellID: view.shellID }))
      return Stream.unwrap(
        Effect.map(get.result(session(view.root)), (opened) =>
          shells.follow({
            id: view.shellID,
            running,
            load: (cursor) =>
              opened.shellOutput(view.sessionID, view.shellID, cursor).pipe(
                Effect.map(Option.some),
                Effect.catchTag("NotFoundError", () => Effect.succeedNone),
              ),
          }),
        ),
      )
    }),
  )

  return {
    handoff,
    session,
    state,
    status,
    boot,
    attention,
    timeline,
    child,
    models,
    agents,
    skills,
    commands,
    files,
    folder,
    file,
    vcs,
    vcsDiff,
    webSearchProviders,
    shellRunning,
    runningShells,
    openedBrowser,
    browser,
    shell,
    shellOutput,
    run,
  }
}

export type ChatAtoms = ReturnType<typeof make>
