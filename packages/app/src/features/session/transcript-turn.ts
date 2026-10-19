export * as TranscriptTurn from "./transcript-turn.js"

import type { SessionMessage } from "@ren/schema/session-message"
import type { TimelineRow } from "@ren/chat"

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
