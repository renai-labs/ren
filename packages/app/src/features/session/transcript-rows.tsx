import { type ChatState, Projection, TimelineRow } from "@ren/chat"
import type { ChatAtoms } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session-message"
import { Transcript } from "@ren/ui/transcript"
import { type PendingAction, type Timeline, TranscriptRow } from "./session-transcript.js"
import { TranscriptTurn } from "./transcript-turn.js"

const none: ReadonlySet<string> = new Set()

const rowMessage = (row: TimelineRow.Row) => {
  if (row._tag === "UserMessage") return row.userMessageID
  if (row._tag === "Notice" || row._tag === "Shell") return row.messageID
  if (row._tag === "AssistantPart")
    return row.group.type === "part" ? row.group.ref.messageID : row.group.refs.at(0)?.messageID
  return
}

export function transcriptRows(props: {
  view?: ChatAtoms.View
  state: ChatState.State
  messages: ReadonlyArray<SessionMessage.Info>
  rows: ReadonlyArray<TimelineRow.Row>
  activeMessageID: string | undefined
  busy: boolean
  working: boolean
  modelNames?: ReadonlyMap<string, string>
  part?: string | undefined
  reverting?: boolean
  updating?: ReadonlySet<string>
  onRevert?: (message: SessionMessage.User) => void
  onPending?: (action: PendingAction, message: SessionMessage.User) => void
  onOpenChild: (sessionID: Session.ID) => void
  onOpenSession?: (sessionID: string) => void
}) {
  const timeline: Timeline = {
    view: props.view,
    state: props.state,
    messages: new Map(props.messages.map((message) => [message.id, message])),
    turns: Projection.assistantMessagesByParent(props.messages),
    lastGroups: Projection.indexes(props.rows).lastAssistantGroupKey,
    contexts: Projection.userContext(props.messages),
    modelNames: props.modelNames ?? new Map(),
    activeMessageID: props.activeMessageID,
    busy: props.busy,
    part: props.part,
    reverting: props.reverting === true,
    updating: props.updating ?? none,
    onRevert: props.onRevert,
    onPending: props.onPending,
    onOpenChild: props.onOpenChild,
    onOpenSession: props.onOpenSession,
  }
  return {
    items: props.rows.filter((row) => row._tag !== "TurnGap"),
    itemKey: TimelineRow.key,
    marker: (row: TimelineRow.Row) => row._tag === "UserMessage",
    itemMessage: rowMessage,
    itemBusy: (row: TimelineRow.Row) => TranscriptTurn.rowBusy(timeline, row),
    renderItem: (row: TimelineRow.Row) => <TranscriptRow timeline={timeline} row={row} />,
    footer: props.working ? <Transcript.Working /> : undefined,
  }
}
