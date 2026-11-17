export * as ChatReact from "./react.js"

import { Debounce } from "@ren/client/react"
import { RegistryContext, scheduleTask, useAtomMount, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import type { SessionVcs } from "@ren/schema/session/vcs"
import type { Shell } from "@ren/schema/shell"
import { Effect, SubscriptionRef } from "effect"
import { AsyncResult, AtomRegistry, type Atom } from "effect/reactivity"
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import type { ChatAtoms } from "./atoms.js"
import type { ChatSession } from "./chat-session.js"
import { ChatState } from "./chat-state.js"
import { Family } from "./family.js"
import { ChatHost } from "./host.js"
import { Mentions } from "./mentions.js"
import { SessionTitle } from "./session-title.js"
import type { TimelineDetail } from "./timeline-detail.js"
import type { TimelineRow } from "./timeline-row.js"
import { Working } from "./working.js"

export interface Runtime {
  readonly generation: number
  readonly userId: string
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
}

const current: { runtime: Runtime | undefined; mounted: Runtime | undefined; generation: number } = {
  runtime: undefined,
  mounted: undefined,
  generation: 0,
}

const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const retire = (runtime: Runtime | undefined) => {
  if (runtime && runtime !== current.mounted) runtime.registry.dispose()
}

export const forget = () => {
  const runtime = current.runtime
  current.runtime = undefined
  retire(runtime)
  for (const listener of listeners) listener()
}

export const runtime = (options: ChatHost.Options): Runtime => {
  if (current.runtime?.userId === options.userId) return current.runtime
  retire(current.runtime)
  void options.cache?.forget(options.userId)
  current.generation += 1
  current.runtime = {
    generation: current.generation,
    userId: options.userId,
    atoms: ChatHost.make(options),
    registry: AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 }),
  }
  return current.runtime
}

export const useRuntime = (options: ChatHost.Options): Runtime => {
  const chat = useSyncExternalStore(subscribe, () => runtime(options))
  useEffect(() => {
    current.mounted = chat
    return () => {
      current.mounted = undefined
      if (current.runtime !== chat) chat.registry.dispose()
    }
  }, [chat])
  return chat
}

const AtomsContext = createContext<ChatAtoms.ChatAtoms | undefined>(undefined)

export function Provider(props: { readonly atoms: ChatAtoms.ChatAtoms; readonly children?: ReactNode }) {
  return createElement(AtomsContext.Provider, { value: props.atoms }, props.children)
}

export const useAtoms = () => {
  const atoms = useContext(AtomsContext)
  if (!atoms) throw new Error("useAtoms needs a ChatReact.Provider")
  return atoms
}

export const useSession = (
  sessionID: Session.ID,
  options: { readonly child?: Session.ID | undefined; readonly detail?: TimelineDetail.Detail | undefined } = {},
) => {
  const atoms = useAtoms()
  useAtomMount(atoms.session(sessionID))
  return {
    state: useAtomValue(atoms.state(sessionID)),
    status: useAtomValue(atoms.status(sessionID)),
    retryAt: useAtomValue(atoms.retryAt(sessionID)),
    boot: useAtomValue(atoms.boot(sessionID)),
    timeline: useAtomValue(
      options.child && options.child !== sessionID
        ? atoms.child({ root: sessionID, sessionID: options.child, detail: options.detail })
        : atoms.timeline({ root: sessionID, detail: options.detail }),
    ),
  }
}

const noRows: ReadonlyArray<TimelineRow.Row> = []

const noActivity: ReadonlyArray<Family.Activity> = []

const workingRoot = (
  state: ChatState.State,
  view: { readonly root: Session.ID; readonly child: Session.ID | undefined },
) => (view.child ? (state.info[view.child]?.parentID ?? view.root) : view.root)

export interface ContextUsage {
  readonly tokens: number
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly model: SessionModel.Ref
  readonly limit?: number
  readonly percent?: number
}

const contextUsageOf = (
  state: ChatState.State,
  sessionID: string,
  models: AsyncResult.AsyncResult<ReadonlyArray<SessionModel.Info>, unknown>,
): ContextUsage | undefined => {
  const step = ChatState.contextStep(state, sessionID)
  if (!step) return undefined
  const tokens = ChatState.contextTokens(step.tokens)
  const limit = AsyncResult.getOrElse(models, () => []).find(
    (each) => SessionModel.key(each) === SessionModel.key(step.model),
  )?.limit.context
  return {
    tokens,
    input: step.tokens.input,
    output: step.tokens.output,
    reasoning: step.tokens.reasoning,
    cacheRead: step.tokens.cache.read,
    cacheWrite: step.tokens.cache.write,
    model: step.model,
    ...(limit && limit > 0 && { limit, percent: Math.min(100, Math.round((tokens / limit) * 100)) }),
  }
}

export function useView(root: Session.ID, child: Session.ID | undefined, detail?: TimelineDetail.Detail) {
  const session = useSession(root, { child, detail })
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const viewed = child ?? root
  const projection = AsyncResult.getOrElse(session.timeline, () => undefined)
  const models = useModels(root)
  const permission = Family.permission(state, viewed)
  const form = Family.form(state, viewed)
  return {
    session,
    state,
    viewed,
    projection,
    loading: !state.messages[viewed] && !AsyncResult.isFailure(session.state),
    messages: ChatState.messages(state, viewed),
    contextUsage: contextUsageOf(state, viewed, models),
    rows: projection?.rows ?? noRows,
    running: ChatState.activity(state, viewed) === "running",
    activity: child ? noActivity : Family.activity(state, root),
    working: projection ? Working.show(state, viewed, projection, workingRoot(state, { root, child })) : false,
    permission,
    permissionTitle: permission ? SessionTitle.child(state, permission.sessionID) : "",
    form,
    formTitle: form ? SessionTitle.child(state, form.sessionID) : "",
    formExpired: form ? Family.isExpired(state, form) : false,
  }
}

export function useSubagentCard(view: ChatAtoms.View, tool: SessionMessage.Tool) {
  const state = AsyncResult.getOrElse(useAtomValue(useAtoms().state(view.root)), () => ChatState.empty)
  return Family.subagent(state, view.sessionID, tool)
}

export const useShellRunning = (root: Session.ID, shellID: Shell.ID) =>
  useAtomValue(useAtoms().shellRunning({ root, shellID }))

export const useShellOutput = (view: ChatAtoms.ShellView) => useAtomValue(useAtoms().shellOutput(view))

export const useModels = (sessionID: Session.ID) => useAtomValue(useAtoms().models(sessionID))

export const useAgents = (sessionID: Session.ID) => useAtomValue(useAtoms().agents(sessionID))

export const useSkills = (sessionID: Session.ID) => useAtomValue(useAtoms().skills(sessionID))

export const useCommands = (sessionID: Session.ID) => useAtomValue(useAtoms().commands(sessionID))

export const useFiles = (search: ChatAtoms.FileQuery) => useAtomValue(useAtoms().files(search))

const unrooted = Session.ID.create()

const fileSearchDelay = 250

export function useFileMentions(root: Session.ID | undefined, query: string | undefined) {
  const text = Debounce.useValue(query ?? "", fileSearchDelay)
  const result = useFiles({ root: root ?? unrooted, query: root ? text : "", type: "file" })
  const [kept, setKept] = useState<ReadonlyArray<Mentions.Item>>([])
  if (AsyncResult.isSuccess(result)) {
    const next = result.value.map(Mentions.fromFile)
    if (next.length !== kept.length || next.some((item, index) => item.id !== kept[index]?.id)) setKept(next)
  }
  const active = root !== undefined && query !== undefined && query !== ""
  return {
    items: active ? kept : [],
    searching: active && (text !== query || AsyncResult.isWaiting(result)),
  }
}

const useRefreshable = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) => ({
  result: useAtomValue(atom),
  refresh: useAtomRefresh(atom),
})

export const useFolder = (view: ChatAtoms.PathView) => useRefreshable(useAtoms().folder(view))

export const useFolders = (root: Session.ID, opened: ReadonlyArray<string>) => {
  const atoms = useAtoms()
  const registry = useContext(RegistryContext)
  return {
    results: useAtomValue(atoms.folders({ root, opened })),
    refresh: useCallback((path: string) => registry.refresh(atoms.folder({ root, path })), [atoms, registry, root]),
  }
}

export const useFileExists = (view: ChatAtoms.PathView) => useAtomValue(useAtoms().fileExists(view))

export const useFile = (view: ChatAtoms.PathView) => useRefreshable(useAtoms().file(view))

export const useVcs = (root: Session.ID) => useRefreshable(useAtoms().vcs(root))

export const useVcsDiff = (root: Session.ID, mode: SessionVcs.Mode) =>
  useRefreshable(useAtoms().vcsDiff({ root, mode }))

export const useRunningShells = (root: Session.ID) => useAtomValue(useAtoms().runningShells(root))

export const useShell = (view: Omit<ChatAtoms.ShellView, "running">) => useAtomValue(useAtoms().shell(view))

export function useAttention(sessionId: string, options: { readonly busy: boolean }): Family.Attention {
  const atoms = useAtoms()
  const attention = useSyncExternalStore(
    (listener) => atoms.attention.subscribe(() => queueMicrotask(listener)),
    () => atoms.attention.read(Session.ID.make(sessionId)),
  )
  return attention ?? (options.busy ? "running" : "idle")
}

export const useStatus = (sessionID: Session.ID) => useAtomValue(useAtoms().status(sessionID))

export const useAction = <A, E, Args extends ReadonlyArray<unknown>>(
  sessionID: Session.ID,
  action: (opened: ChatSession.ChatSession, ...args: Args) => Effect.Effect<A, E>,
) => {
  const atoms = useAtoms()
  const registry = useContext(RegistryContext)
  return useCallback(
    (...args: Args) => Effect.runPromise(atoms.run(registry, sessionID, (opened) => action(opened, ...args))),
    [atoms, registry, sessionID, action],
  )
}

export const usePrompt = (root: Session.ID) =>
  useAction(root, (opened, request: ChatSession.PromptInput) =>
    opened.prompt(request).pipe(
      Effect.retry({ times: 1 }),
      Effect.catch((error) =>
        Effect.flatMap(SubscriptionRef.get(opened.state), (current) =>
          request.id && ChatState.knows(current, root, request.id) ? Effect.void : Effect.fail(error),
        ),
      ),
    ),
  )

export function useSecondsUntil(at: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.ceil((at - now) / 1000))
}
