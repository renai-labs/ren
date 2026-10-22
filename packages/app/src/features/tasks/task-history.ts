export * as TaskHistory from "./task-history.js"

import type { TaskActivityInfo, TaskEventInfo } from "@ren/client"

export interface Group {
  readonly id: string
  readonly quiet: boolean
  readonly items: ReadonlyArray<TaskActivityInfo>
}

export function groups(items: ReadonlyArray<TaskActivityInfo>): ReadonlyArray<Group> {
  return items.reduce<Array<{ id: string; quiet: boolean; items: TaskActivityInfo[] }>>((groups, item) => {
    const quiet =
      item.type === "event" &&
      !["started", "review_requested", "reviewed"].includes(item.event.data._tag) &&
      !(item.event.data._tag === "created" && item.event.actor.sessionId)
    const group = groups.at(-1)
    if (!quiet || !group?.quiet) {
      groups.push({ id: item.id, quiet, items: [item] })
      return groups
    }
    const last = group.items.at(-1)
    const merged = last?.type === "event" ? mergeStatus(last.event, item.event) : undefined
    if (merged && last) group.items[group.items.length - 1] = { id: last.id, type: "event", event: merged }
    else group.items.push(item)
    return groups
  }, [])
}

function mergeStatus(previous: TaskEventInfo, next: TaskEventInfo): TaskEventInfo | undefined {
  if (previous.data._tag !== "status" || next.data._tag !== "status") return
  if (previous.data.to !== next.data.from) return
  if (
    previous.actor.userId !== next.actor.userId ||
    previous.actor.agentId !== next.actor.agentId ||
    previous.actor.sessionId !== next.actor.sessionId
  )
    return
  return { ...previous, data: { ...previous.data, to: next.data.to } }
}
