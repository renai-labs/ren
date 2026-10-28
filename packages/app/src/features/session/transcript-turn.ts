export * as TranscriptTurn from "./transcript-turn.js"

import { ChannelReply, Projection, TimelineRow, ToolDisplay } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"

export interface Turns {
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly activeMessageID: string | undefined
  readonly busy: boolean
}

export const working = (timeline: Turns, turnID: string) => {
  const last = timeline.turns.get(turnID)?.at(-1)
  return timeline.busy && timeline.activeMessageID === turnID && last !== undefined && !last.time.completed
}

export const rowBusy = (timeline: Turns, row: TimelineRow.Row) =>
  (row._tag === "AssistantPart" || row._tag === "Thinking") && working(timeline, row.userMessageID)

export type Block =
  | { readonly kind: "row"; readonly key: string; readonly row: TimelineRow.Row }
  | {
      readonly kind: "turn"
      readonly key: string
      readonly turn: string
      readonly rows: ReadonlyArray<TimelineRow.Row>
    }

type Role = "user" | "step" | "answer" | "other"

const partRole = (row: TimelineRow.AssistantPart, messages: ReadonlyMap<string, SessionMessage.Info>): Role => {
  if (row.group.type !== "part") return "step"
  const content = Projection.resolveContent(messages.get(row.group.ref.messageID), row.group.ref.partID)
  if (content?.type === "text") return "answer"
  return content?.type === "tool" && ChannelReply.shown(content) ? "answer" : "step"
}

const roleOf = (row: TimelineRow.Row, messages: ReadonlyMap<string, SessionMessage.Info>): Role => {
  if (row._tag === "UserMessage") return "user"
  if (row._tag === "AssistantPart") return partRole(row, messages)
  return row._tag === "Thinking" || row._tag === "Shell" ? "step" : "other"
}

export const steps = (row: TimelineRow.Row, messages: ReadonlyMap<string, SessionMessage.Info>) => {
  if (row._tag !== "AssistantPart") return row._tag === "Thinking" || row._tag === "Shell" ? 1 : 0
  if (row.group.type !== "part") return row.group.refs.length
  const content = Projection.resolveContent(messages.get(row.group.ref.messageID), row.group.ref.partID)
  return content?.type === "tool" && ToolDisplay.hidden(content) ? 0 : 1
}

// oxlint-disable-next-line ren/no-comments -- A turn's work, from its first step to its last, is one Worked group. Answers between steps join it; the answer after the last step stays outside, like PR #77.
export function blocks(rows: ReadonlyArray<TimelineRow.Row>, messages: ReadonlyMap<string, SessionMessage.Info>) {
  const roles = rows.map((row) => roleOf(row, messages))
  const lastStep = new Map(rows.flatMap((row, index) => (roles[index] === "step" ? [[row.userMessageID, index]] : [])))
  return rows.reduce<Array<Block>>((all, row, index) => {
    const role = roles[index]
    const grouped = role === "step" || (role === "answer" && index < (lastStep.get(row.userMessageID) ?? -1))
    const last = all.at(-1)
    if (!grouped) all.push({ kind: "row", key: TimelineRow.key(row), row })
    else if (last?.kind === "turn" && last.turn === row.userMessageID)
      all[all.length - 1] = { ...last, rows: [...last.rows, row] }
    else all.push({ kind: "turn", key: TimelineRow.key(row), turn: row.userMessageID, rows: [row] })
    return all
  }, [])
}
