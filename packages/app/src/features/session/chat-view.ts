export * as ChatView from "./chat-view.js"

import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family, SessionTasks, TimelineRow, Working } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Equal } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { SessionTitle } from "./session-title.js"

const noRows: ReadonlyArray<TimelineRow.Row> = []

function useEqual<A>(value: A) {
  const [kept, setKept] = useState(value)
  if (Equal.equals(kept, value)) return kept
  setKept(value)
  return value
}

const statuses = (state: ChatState.State, sessionID: Session.ID): ReadonlyMap<string, ChatState.PendingStatus> =>
  new Map(
    ChatState.pending(state, sessionID).flatMap((item) => {
      const status = item.type === "user" ? ChatState.pendingStatus(state, sessionID, item.id) : undefined
      return status ? [[item.id, status] as const] : []
    }),
  )

const childTitle = (state: ChatState.State, sessionID: string) =>
  SessionTitle.display(Family.childTitle(state, sessionID, ""), "Subagent")

const requests = (state: ChatState.State, sessionID: string) => {
  const permission = Family.permission(state, sessionID)
  const form = Family.form(state, sessionID)
  return {
    permission,
    permissionTitle: permission ? childTitle(state, permission.sessionID) : "",
    form,
    formTitle: form ? childTitle(state, form.sessionID) : "",
    formExpired: form ? Family.isExpired(state, form) : false,
    connection: state.connection,
  }
}

export function useRoot(sessionID: Session.ID, child: Session.ID | undefined) {
  const session = ChatReact.useSession(sessionID)
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const timeline = AsyncResult.isSuccess(session.timeline) ? session.timeline.value : undefined
  const messages = ChatState.messages(state, sessionID)
  const parent = child ? state.info[child]?.parentID : undefined
  return {
    info: state.info[sessionID],
    messages,
    rows: timeline?.rows ?? noRows,
    activeMessageID: timeline?.activeMessageID,
    running: ChatState.activity(state, sessionID) === "running",
    working: timeline ? Working.show(state, sessionID, timeline) : false,
    asking: ChatState.permissionSessions(state).length + ChatState.formSessions(state).length,
    prompted: ChatState.visibleUserMessages(state, sessionID).length > 0,
    reverted: ChatState.revertMessageID(state, sessionID) !== undefined,
    pending: ChatState.pending(state, sessionID),
    statuses: statuses(state, sessionID),
    requests: requests(state, sessionID),
    background: useEqual(Family.background(state, sessionID)),
    tasks: useEqual(SessionTasks.latest(messages)),
    more: ChatState.more(state, sessionID),
    loadingHistory: ChatState.loadingHistory(state, sessionID),
    reconnecting: AsyncResult.isSuccess(session.status) && session.status.value === "reconnecting",
    failed: AsyncResult.isFailure(session.state),
    childParent: parent && parent !== sessionID ? Session.ID.make(parent) : undefined,
  }
}

export function useChild(root: Session.ID, sessionID: Session.ID, rootTitle: string) {
  const state = AsyncResult.getOrElse(ChatReact.useSession(root).state, () => ChatState.empty)
  const result = ChatReact.useChild(root, sessionID)
  const timeline = AsyncResult.isSuccess(result) ? result.value : undefined
  const parent = state.info[sessionID]?.parentID ?? root
  const title = (id: string) => (id === root ? rootTitle : childTitle(state, id))
  return {
    messages: ChatState.messages(state, sessionID),
    rows: timeline?.rows ?? noRows,
    activeMessageID: timeline?.activeMessageID,
    running: ChatState.activity(state, sessionID) === "running",
    working: timeline ? Working.show(state, sessionID, timeline, parent) : false,
    title: childTitle(state, sessionID),
    parent,
    parentTitle: title(parent),
    ancestors: useEqual(
      (Family.ancestors(state, sessionID).length > 0 ? Family.ancestors(state, sessionID) : [root]).map((id) => ({
        id,
        title: title(id),
      })),
    ),
    statuses: statuses(state, sessionID),
    requests: requests(state, sessionID),
    more: ChatState.more(state, sessionID),
    loadingHistory: ChatState.loadingHistory(state, sessionID),
    failed: AsyncResult.isFailure(result),
  }
}

export function useSubagent(root: Session.ID, sessionID: Session.ID, tool: SessionMessage.Tool) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(root)), () => ChatState.empty)
  return Family.subagent(state, sessionID, tool)
}
