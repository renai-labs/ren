export * as Timeline from "./timeline.js"

import { TimelineRow } from "@ren/chat"

export const messageIDs = (row: TimelineRow.Row): ReadonlyArray<string> => {
  if (row._tag === "UserMessage") return [row.userMessageID]
  if (row._tag === "Notice" || row._tag === "Shell") return [row.messageID]
  if (row._tag !== "AssistantPart") return []
  return (row.group.type === "part" ? [row.group.ref] : row.group.refs).map((reference) => reference.messageID)
}

export function rowFor(rows: ReadonlyArray<TimelineRow.Row>, messageID: string | undefined) {
  const row = messageID ? rows.find((item) => messageIDs(item).includes(messageID)) : undefined
  return row && TimelineRow.key(row)
}

export function rowForPart(rows: ReadonlyArray<TimelineRow.Row>, matches: (reference: TimelineRow.PartRef) => boolean) {
  const row = rows.findLast(
    (item) =>
      item._tag === "AssistantPart" &&
      (item.group.type === "part" ? [item.group.ref] : item.group.refs).some((reference) => matches(reference)),
  )
  return row && TimelineRow.key(row)
}
