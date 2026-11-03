import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"

export function useRunningAgent(root: Session.ID) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(root)), () => ChatState.empty)
  return ChatState.messages(state, root).findLast((message) => message.type === "assistant")?.agent
}

export function notificationsOf(state: ChatState.State, root: Session.ID) {
  const family = Family.tree(state, root)
  const last = ChatState.messages(state, root).at(-1)
  const failed = last?.type === "idle" ? last.outcome === "failed" : false
  const interrupted = last?.type === "idle" ? last.outcome === "interrupted" : false
  const permissions = family.flatMap((sessionID) =>
    (state.permissions[sessionID] ?? []).map((request) => ({
      kind: "permissions" as const,
      id: request.id,
      sessionID,
    })),
  )
  const questions = family.flatMap((sessionID) =>
    (state.forms[sessionID] ?? [])
      .filter((form) => form.kind === "question" || form.kind === "websearch.provider")
      .map((form) => ({ kind: "questions" as const, id: form.id, sessionID })),
  )
  return {
    delegated: family.some((id) => id !== root && ChatState.activity(state, id) === "running"),
    outcome: last?.type === "idle" && !interrupted ? { id: last.id, failed } : undefined,
    requests: [...permissions, ...questions],
  }
}
