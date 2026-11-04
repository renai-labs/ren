import { useAtomValue } from "@effect/atom-react"
import type { ChatAtoms, ChatSession } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { QueryClient } from "@tanstack/react-query"
import { Effect, Stream, SubscriptionRef } from "effect"
import { AsyncResult, Atom } from "effect/reactivity"
import type { Platform } from "../platform/platform.js"

export function chatFor(platform: Platform.Info, userId: string) {
  return ChatReact.runtime({
    serverUrl: platform.serverUrl,
    userId,
    storage: platform.storage,
    fetch: platform.fetch,
    lifecycle: platform.onLifecycle,
  })
}

export function handoff(platform: Platform.Info, userId: string, sessionID: Session.ID, message: ChatSession.Handoff) {
  chatFor(platform, userId).atoms.handoff(sessionID, message)
}

export function resetSession(queryClient: QueryClient) {
  ChatReact.forget()
  queryClient.clear()
}

const autoApproveFamilies = new WeakMap<
  ChatAtoms.ChatAtoms,
  (sessionID: Session.ID) => Atom.Atom<AsyncResult.AsyncResult<boolean, unknown>>
>()

const autoApproveFamily = (atoms: ChatAtoms.ChatAtoms) => {
  const found = autoApproveFamilies.get(atoms)
  if (found) return found
  const family = Atom.family((sessionID: Session.ID) =>
    Atom.make((get) =>
      Stream.unwrap(
        Effect.map(get.result(atoms.session(sessionID)), (opened) => SubscriptionRef.changes(opened.autoApprove)),
      ),
    ),
  )
  autoApproveFamilies.set(atoms, family)
  return family
}

export function useAutoApprove(sessionID: Session.ID) {
  const result = useAtomValue(autoApproveFamily(ChatReact.useAtoms())(sessionID))
  const set = ChatReact.useAction(sessionID, (opened, approval: { readonly enabled: boolean }) =>
    SubscriptionRef.set(opened.autoApprove, approval.enabled),
  )
  return { enabled: AsyncResult.isSuccess(result) && result.value, set }
}
