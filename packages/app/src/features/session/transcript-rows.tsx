import { type ChatState, Projection, type TimelineDetail, TimelineRow, TimelineText } from "@ren/chat"
import type { ChatAtoms } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import { Transcript } from "@ren/ui/transcript"
import { DateTime, Match } from "effect"
import { type PendingAction, type Person, type RowData, type Shared, TranscriptRow } from "./session-transcript.js"
import { Timeline } from "./timeline.js"
import { FilesReset } from "./transcript-notice.js"
import { TranscriptTurn } from "./transcript-turn.js"

const none: ReadonlySet<string> = new Set()

const nobody: ReadonlyMap<string, Person> = new Map()

const unnamed: ReadonlyMap<string, string> = new Map()

const member: Person = { name: "Member", image: undefined }

const responseMeta = (turn: SessionMessage.Info | undefined, assistants: ReadonlyArray<SessionMessage.Assistant>) => {
  const duration = TimelineText.duration(
    TimelineText.turnDuration(turn?.type === "user" ? turn : undefined, assistants) ?? -1,
  )
  const interrupted = Projection.isInterrupted(assistants.at(-1)?.error)
  return [duration, interrupted ? "Interrupted" : undefined].filter(Boolean).join(" · ")
}

export function useTranscriptRows(props: {
  view: ChatAtoms.View
  statuses: ReadonlyMap<string, ChatState.PendingStatus>
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
  filesResetAt?: DateTime.Utc | null
}) {
  const messages: ReadonlyMap<string, SessionMessage.Info> = new Map(
    props.messages.map((message) => [message.id, message]),
  )
  const turns: TranscriptTurn.Turns = {
    turns: Projection.assistantMessagesByParent(props.messages),
    activeMessageID: props.activeMessageID,
    busy: props.busy,
  }
  const modelNames = props.modelNames ?? unnamed
  const people = props.people ?? nobody
  const updating = props.updating ?? none
  const lastGroups = Projection.indexes(props.rows).lastAssistantGroupKey
  const contexts: ReadonlyMap<string, { readonly model: SessionModel.Ref }> = Projection.userContext(props.messages)
  const shared: Shared = {
    root: props.view.root,
    sessionID: props.view.sessionID,
    part: props.part,
    reverting: props.reverting === true,
    detail: props.detail,
    onRevert: props.onRevert,
    onPending: props.onPending,
    onOpenChild: props.onOpenChild,
    onOpenSession: props.onOpenSession,
  }
  const empty = (): RowData => ({})
  const data = Match.typeTags<TimelineRow.Row, RowData>()({
    UserMessage: (row) => {
      const message = messages.get(row.userMessageID)
      const context = contexts.get(row.userMessageID)
      const status = props.statuses.get(row.userMessageID)
      const senderID = message?.type === "user" ? message.sender?.userId : undefined
      const sender = senderID && senderID !== props.viewer ? (people.get(senderID) ?? member) : undefined
      return {
        message,
        status,
        caption: [
          status === "steering" || status === "stranded" ? "Pending" : undefined,
          context ? TimelineText.modelLabel(context.model, modelNames) : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        sender: sender?.name,
        senderImage: sender?.image,
        updating: updating.has(row.userMessageID),
      }
    },
    AssistantPart: (row) => {
      const group = row.group
      const working = TranscriptTurn.working(turns, row.userMessageID)
      if (group.type !== "part")
        return {
          messages: group.refs.map((reference) => messages.get(reference.messageID)),
          working: working && lastGroups.get(row.userMessageID) === group.key,
        }
      const assistants = turns.turns.get(row.userMessageID) ?? []
      const copy = TimelineText.copyText(assistants)
      const copyable = copy?.partID === group.ref.partID && !working
      return {
        message: messages.get(group.ref.messageID),
        copy: copyable ? copy.text : undefined,
        meta: copyable ? responseMeta(messages.get(row.userMessageID), assistants) : undefined,
      }
    },
    Notice: (row) => ({ message: messages.get(row.messageID) }),
    Shell: (row) => ({ message: messages.get(row.messageID) }),
    Thinking: (row) => ({ message: messages.get(row.ref.messageID) }),
    Retry: (row) => ({
      retry:
        props.activeMessageID === row.userMessageID
          ? TimelineText.retryStatus(turns.turns.get(row.userMessageID) ?? [])
          : undefined,
    }),
    Error: empty,
    TurnDivider: empty,
    CompactionQueued: empty,
    TurnGap: empty,
  })
  // oxlint-disable-next-line ren/no-comments -- The chat moved to a new machine at filesResetAt: the notice goes before the first message after that time, or at the end (E117). It waits for the chat's rows, so the list never starts with the footer alone.
  const resetAt = props.rows.length > 0 ? props.filesResetAt : undefined
  const resetBefore = resetAt
    ? props.rows.find((row) => {
        const message = row._tag === "UserMessage" ? messages.get(row.userMessageID) : undefined
        return message !== undefined && DateTime.isGreaterThanOrEqualTo(message.time.created, resetAt)
      })
    : undefined
  const notice = resetAt ? <FilesReset /> : undefined
  const working = props.working ? <Transcript.Working /> : undefined
  return {
    items: props.rows.filter((row) => row._tag !== "TurnGap"),
    itemKey: TimelineRow.key,
    marker: (row: TimelineRow.Row) => row._tag === "UserMessage",
    itemMessage: (row: TimelineRow.Row) => Timeline.messageIDs(row).at(0),
    itemBusy: (row: TimelineRow.Row) => TranscriptTurn.rowBusy(turns, row),
    renderItem: (row: TimelineRow.Row) =>
      row === resetBefore ? (
        <>
          <div className="pb-4 md:pb-6">{notice}</div>
          <TranscriptRow shared={shared} data={data(row)} row={row} />
        </>
      ) : (
        <TranscriptRow shared={shared} data={data(row)} row={row} />
      ),
    footer:
      notice && !resetBefore ? (
        <>
          {notice}
          {working}
        </>
      ) : (
        working
      ),
  }
}
