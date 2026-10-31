import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family, Working, type ChatAtoms, type TimelineRow } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { AsyncResult } from "effect/reactivity"
import { sessionTitle } from "../../lib/sessions.js"

const noRows: ReadonlyArray<TimelineRow.Row> = []

export const childTitle = (state: ChatState.State, sessionID: string) =>
  sessionTitle(Family.childTitle(state, sessionID, ""), "Subagent")

const workingRoot = (
  state: ChatState.State,
  view: { readonly root: Session.ID; readonly child: Session.ID | undefined },
) => (view.child ? (state.info[view.child]?.parentID ?? view.root) : view.root)

export function useView(root: Session.ID, child: Session.ID | undefined) {
  const session = ChatReact.useSession(root)
  const childResult = ChatReact.useChild(root, child ?? root)
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
    messages: ChatState.messages(state, viewed),
    rows: projection?.rows ?? noRows,
    running: ChatState.activity(state, viewed) === "running",
    working: projection ? Working.show(state, viewed, projection, workingRoot(state, { root, child })) : false,
    permission,
    permissionTitle: permission ? childTitle(state, permission.sessionID) : "",
    form,
    formTitle: form ? childTitle(state, form.sessionID) : "",
    formExpired: form ? Family.isExpired(state, form) : false,
  }
}

export function useSubagentCard(view: ChatAtoms.View, tool: SessionMessage.Tool) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(view.root)), () => ChatState.empty)
  return Family.subagent(state, view.sessionID, tool)
}
