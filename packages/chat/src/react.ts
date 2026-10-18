export * as ChatReact from "./react.js"

import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react"
import type { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { createContext, createElement, type ReactNode, useCallback, useContext } from "react"
import type { ChatAtoms } from "./atoms.js"
import type { ChatSession } from "./chat-session.js"

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
    timeline: useAtomValue(atoms.timeline(sessionID)),
  }
}

export const useModels = (sessionID: Session.ID) => useAtomValue(useAtoms().models(sessionID))

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
