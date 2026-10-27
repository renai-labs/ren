import type { FactoryTask, FactoryTaskEvent, Timeline, Visit } from "./types.js"

export function buildTimelines(tasks: FactoryTask[], events: FactoryTaskEvent[]): Timeline[] {
  const byId = new Map<string, Timeline>()
  for (const task of tasks) byId.set(task.id, { task, createdAt: Number.POSITIVE_INFINITY, visits: [], flags: [] })

  for (const event of events.toSorted((a, b) => a.at - b.at)) {
    const timeline = byId.get(event.taskId)
    if (!timeline) continue
    recordTimeline(timeline, event)
    recordVisit(timeline, event)
  }
  return [...byId.values()].filter((timeline) => Number.isFinite(timeline.createdAt))
}

function recordTimeline(timeline: Timeline, event: FactoryTaskEvent) {
  if (event.type === "task.created") timeline.createdAt = event.at
  if (event.type === "task.started" && event.data.pr) timeline.pr = event.data.pr
  if (event.type === "task.flagged") timeline.flags.push({ at: event.at, note: event.data.note })
  if (event.type === "task.done") {
    timeline.doneAt = event.at
    timeline.outcome = event.data.outcome
  }
}

function recordVisit(timeline: Timeline, event: FactoryTaskEvent) {
  const current = timeline.visits.at(-1)
  const open = (visit: Visit) => {
    if (current && !current.leftAt) current.leftAt = visit.enteredAt
    timeline.visits.push(visit)
  }
  if (event.type === "task.created" && (event.data.stage === "backlog" || timeline.task.kind === "alert"))
    open({ stage: event.data.stage, enteredAt: event.at, waits: [] })
  if (event.type === "task.queued")
    open({
      stage: event.data.stage,
      enteredAt: event.at,
      ...(event.data.startsAt ? { startsAt: event.data.startsAt } : {}),
      waits: [],
    })
  if (!current) return
  if (event.type === "task.started") current.startedAt = event.at
  if (event.type === "task.stage_completed") {
    current.leftAt = event.at
    current.costUsd = event.data.costUsd
    current.tokens = event.data.tokens
    current.activeMs = event.data.activeMs
  }
  if (event.type === "task.done" && !current.leftAt) current.leftAt = event.at
  recordWait(current, event)
}

function recordWait(visit: Visit, event: FactoryTaskEvent) {
  if (event.type === "task.needs_human") visit.waits.push({ gate: event.data.gate, from: event.at })
  if (event.type !== "task.human_resolved" || event.data.gate === "triage_backlog") return
  const wait = visit.waits.at(-1)
  if (!wait || wait.to) return
  wait.to = event.at
  wait.resolution = event.data.resolution
  wait.by = event.data.by
}

export function visitAt(timeline: Timeline, t: number): Visit | undefined {
  const visits = timeline.visits
  let lo = 0
  let hi = visits.length - 1
  let found: Visit | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const visit = visits[mid]
    if (visit && visit.enteredAt <= t) {
      found = visit
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

export function activeBetween(visit: Visit, from: number, to: number): number {
  if (!visit.startedAt) return 0
  const start = Math.max(visit.startedAt, from)
  const end = Math.min(visit.leftAt ?? Number.POSITIVE_INFINITY, to)
  if (end <= start) return 0
  let total = end - start
  for (const wait of visit.waits) {
    const a = Math.max(wait.from, start)
    const b = Math.min(wait.to ?? Number.POSITIVE_INFINITY, end)
    if (b > a) total -= b - a
  }
  return Math.max(0, total)
}
