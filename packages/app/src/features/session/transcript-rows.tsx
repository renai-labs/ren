import { type ChatState, Projection, type TimelineDetail, TimelineRow } from "@ren/chat"
import type { ChatAtoms } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Transcript } from "@ren/ui/transcript"
import { type PendingAction, type Person, TranscriptRow } from "./session-transcript.js"
import type { Timeline as TranscriptTimeline } from "./session-transcript.js"
import { Timeline } from "./timeline.js"
import { TranscriptTurn } from "./transcript-turn.js"

const none: ReadonlySet<string> = new Set()

const nobody: ReadonlyMap<string, Person> = new Map()

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
  detail?: TimelineDetail.Detail | undefined
  viewer?: string
  people?: ReadonlyMap<string, Person>
}) {
  const timeline: TranscriptTimeline = {
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
    detail: props.detail,
    viewer: props.viewer,
    people: props.people ?? nobody,
  }
  return {
    items: props.rows.filter((row) => row._tag !== "TurnGap"),
    itemKey: TimelineRow.key,
    marker: (row: TimelineRow.Row) => row._tag === "UserMessage",
    itemMessage: (row: TimelineRow.Row) => Timeline.messageIDs(row).at(0),
    itemBusy: (row: TimelineRow.Row) => TranscriptTurn.rowBusy(timeline, row),
    renderItem: (row: TimelineRow.Row) => <TranscriptRow timeline={timeline} row={row} />,
    footer: props.working ? <Transcript.Working /> : undefined,
  }
}
