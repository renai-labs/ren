import { Projection, TimelineRow } from "@ren/chat"
import type { ChatAtoms } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session-message"
import { Transcript } from "@ren/ui/transcript"
import { type Timeline, TranscriptRow } from "./session-transcript.js"

export function transcriptRows(props: {
  view?: ChatAtoms.View
  messages: ReadonlyArray<SessionMessage.Info>
  rows: ReadonlyArray<TimelineRow.Row>
  activeMessageID: string | undefined
  busy: boolean
  working: boolean
  onRevert?: (message: SessionMessage.User) => void
  onOpenChild: (sessionID: Session.ID) => void
}) {
  const timeline: Timeline = {
    view: props.view,
    messages: new Map(props.messages.map((message) => [message.id, message])),
    turns: Projection.assistantMessagesByParent(props.messages),
    lastGroups: Projection.indexes(props.rows).lastAssistantGroupKey,
    activeMessageID: props.activeMessageID,
    busy: props.busy,
    onRevert: props.onRevert,
    onOpenChild: props.onOpenChild,
  }
  return {
    items: props.rows.filter((row) => row._tag !== "TurnGap"),
    itemKey: TimelineRow.key,
    marker: (row: TimelineRow.Row) => row._tag === "UserMessage",
    renderItem: (row: TimelineRow.Row) => <TranscriptRow timeline={timeline} row={row} />,
    footer: props.working ? <Transcript.Working /> : undefined,
  }
}
