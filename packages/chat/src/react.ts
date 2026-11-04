export * as ChatReact from "./react.js"

import { RegistryContext, scheduleTask, useAtomMount, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import { Effect, SubscriptionRef } from "effect"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { createContext, createElement, type ReactNode, useCallback, useContext } from "react"
import type { ChatAtoms } from "./atoms.js"
import { ChatState } from "./chat-state.js"
import { Family } from "./family.js"
import { SessionTitle } from "./session-title.js"
import type { TimelineRow } from "./timeline-row.js"
import { Working } from "./working.js"
import type { ChatSession } from "./chat-session.js"
import { ChatHost } from "./host.js"

export interface Runtime {
  readonly userId: string
  readonly atoms: ChatAtoms.ChatAtoms
  readonly registry: AtomRegistry.AtomRegistry
}

const current: { runtime: Runtime | undefined } = { runtime: undefined }

export const forget = () => {
  current.runtime?.registry.dispose()
  current.runtime = undefined
}

export const runtime = (options: ChatHost.Options): Runtime => {
  if (current.runtime?.userId === options.userId) return current.runtime
  forget()
  current.runtime = {
    userId: options.userId,
    atoms: ChatHost.make(options),
    registry: AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 }),
  }
  return current.runtime
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

export const useSession = (sessionID: Session.ID) => {
  const atoms = useAtoms()
  useAtomMount(atoms.session(sessionID))
  return {
    state: useAtomValue(atoms.state(sessionID)),
    status: useAtomValue(atoms.status(sessionID)),
    boot: useAtomValue(atoms.boot(sessionID)),
    timeline: useAtomValue(atoms.timeline(sessionID)),
  }
}

const noRows: ReadonlyArray<TimelineRow.Row> = []

const workingRoot = (
  state: ChatState.State,
  view: { readonly root: Session.ID; readonly child: Session.ID | undefined },
) => (view.child ? (state.info[view.child]?.parentID ?? view.root) : view.root)

export function useView(root: Session.ID, child: Session.ID | undefined) {
  const session = useSession(root)
  const childResult = useChild(root, child ?? root)
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const viewed = child ?? root
  const projection = AsyncResult.getOrElse(child ? childResult : session.timeline, () => undefined)
  const permission = Family.permission(state, viewed)
  const form = Family.form(state, viewed)
  return {
    session,
    state,
    viewed,
    projection,
    loading: !state.messages[viewed] && !AsyncResult.isFailure(session.state),
    messages: ChatState.messages(state, viewed),
    rows: projection?.rows ?? noRows,
    running: ChatState.activity(state, viewed) === "running",
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

export const useChild = (root: Session.ID, sessionID: Session.ID) => useAtomValue(useAtoms().child({ root, sessionID }))

export const useShellRunning = (root: Session.ID, shellID: Shell.ID) =>
  useAtomValue(useAtoms().shellRunning({ root, shellID }))

export const useShellOutput = (view: ChatAtoms.ShellView) => useAtomValue(useAtoms().shellOutput(view))

export const useModels = (sessionID: Session.ID) => useAtomValue(useAtoms().models(sessionID))

export const useAgents = (sessionID: Session.ID) => useAtomValue(useAtoms().agents(sessionID))

export const useSkills = (sessionID: Session.ID) => useAtomValue(useAtoms().skills(sessionID))

export const useCommands = (sessionID: Session.ID) => useAtomValue(useAtoms().commands(sessionID))

export const useFiles = (search: ChatAtoms.FileQuery) => useAtomValue(useAtoms().files(search))

export const useStatus = (sessionID: Session.ID) => useAtomValue(useAtoms().status(sessionID))

export const useWebSearchProviders = (root: Session.ID, sessionID: Session.ID) => {
  const atom = useAtoms().webSearchProviders({ root, sessionID })
  return { result: useAtomValue(atom), retry: useAtomRefresh(atom) }
}

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
