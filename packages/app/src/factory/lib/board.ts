import { AREAS } from "./catalog"
import { rngFor, pick, type Rng } from "./rng"
import { costPerMs, tokensPerUsd } from "./simulate"
import { MINUTE, startOfDay } from "./time"
import { activeBetween, visitAt } from "./timeline"
import type { FactoryTask, FactoryWorld, HumanGate, Stage, Timeline, Visit } from "./types"

type CardPhase = "backlog" | "queued" | "working" | "waiting"

export type CardModel = {
  id: string
  at: number
  timeline: Timeline
  stage: Stage
  phase: CardPhase
  gate?: HumanGate
  enteredAt: number
  startedAt?: number
  elapsedMs: number
  costUsd: number
  tokens: number
  activity?: string
  queueIndex?: number
  startsAt?: number
  scheduled?: boolean
}

export type ColumnModel = {
  stage: Stage
  cards: CardModel[]
  queue: CardModel[]
  working: number
  waiting: number
  queued: number
  spentToday: number
  tokensToday: number
  oldestMs: number
}

export type BoardModel = Record<Stage, ColumnModel>

type Reorder = { at: number; taskId: string; before?: string }

const reorderCache = new WeakMap<FactoryWorld, Reorder[]>()

function reordersOf(world: FactoryWorld): Reorder[] {
  const cached = reorderCache.get(world)
  if (cached) return cached
  const reorders = world.events.flatMap((event) =>
    event.type === "task.reordered"
      ? [{ at: event.at, taskId: event.taskId, ...(event.data.before ? { before: event.data.before } : {}) }]
      : [],
  )
  reorderCache.set(world, reorders)
  return reorders
}

function applyReorders(cards: CardModel[], reorders: Reorder[], t: number): CardModel[] {
  if (reorders.length === 0) return cards
  const list = [...cards]
  for (const move of reorders) {
    if (move.at > t) break
    const from = list.findIndex((card) => card.id === move.taskId)
    const card = list[from]
    if (!card) continue
    list.splice(from, 1)
    const target = move.before ? list.findIndex((other) => other.id === move.before) : -1
    list.splice(target < 0 ? list.length : target, 0, card)
  }
  return list
}

function emptyColumn(stage: Stage): ColumnModel {
  return { stage, cards: [], queue: [], working: 0, waiting: 0, queued: 0, spentToday: 0, tokensToday: 0, oldestMs: 0 }
}

function addSpendToday(board: BoardModel, timeline: Timeline, dayStart: number, t: number) {
  for (const visit of timeline.visits) {
    if (visit.stage === "backlog" || !visit.startedAt || visit.startedAt > t) continue
    if (visit.leftAt && visit.leftAt < dayStart) continue
    const active = activeBetween(visit, dayStart, t)
    if (active <= 0) continue
    const cost = active * costPerMs(timeline.task.id, visit.stage)
    const column = board[visit.stage]
    column.spentToday += cost
    column.tokensToday += cost * tokensPerUsd(visit.stage)
  }
}

function settleColumn(column: ColumnModel, reorders: Reorder[], t: number) {
  column.cards = column.cards.toSorted(
    (a, b) => (a.startedAt ?? a.enteredAt) - (b.startedAt ?? b.enteredAt) || a.id.localeCompare(b.id),
  )
  column.queue = applyReorders(
    column.queue.toSorted(
      (a, b) => (a.startsAt ?? a.enteredAt) - (b.startsAt ?? b.enteredAt) || a.id.localeCompare(b.id),
    ),
    reorders,
    t,
  )
  for (const [index, card] of column.queue.entries()) card.queueIndex = index + 1
  column.working = column.cards.filter((card) => card.phase === "working").length
  column.waiting = column.cards.filter((card) => card.phase === "waiting").length
  column.queued = column.queue.length
  if (column.stage !== "backlog") return
  column.cards = applyReorders(
    column.cards.toSorted((a, b) => b.enteredAt - a.enteredAt),
    reorders,
    t,
  )
  column.oldestMs = column.cards.reduce((max, card) => Math.max(max, t - card.enteredAt), 0)
}

export function deriveBoard(world: FactoryWorld, t: number): BoardModel {
  const dayStart = startOfDay(t)
  const board: BoardModel = {
    backlog: emptyColumn("backlog"),
    plan: emptyColumn("plan"),
    build: emptyColumn("build"),
    review: emptyColumn("review"),
    qa: emptyColumn("qa"),
    monitoring: emptyColumn("monitoring"),
  }

  for (const timeline of world.timelines) {
    if (timeline.createdAt > t) continue
    addSpendToday(board, timeline, dayStart, t)
    if (timeline.doneAt && timeline.doneAt <= t) continue
    const visit = visitAt(timeline, t)
    if (!visit || (visit.leftAt && visit.leftAt <= t)) continue
    const card = cardFor(timeline, visit, t)
    const column = board[visit.stage]
    if (card.phase === "queued") column.queue.push(card)
    else column.cards.push(card)
  }

  const reorders = reordersOf(world)
  for (const column of Object.values(board)) settleColumn(column, reorders, t)
  return board
}

function waitAt(visit: Visit, t: number) {
  return visit.waits.find((wait) => wait.from <= t && (!wait.to || wait.to > t))
}

function phaseOf(visit: Visit, t: number): Exclude<CardPhase, "backlog"> {
  if (waitAt(visit, t)) return "waiting"
  return (visit.startedAt ?? Number.POSITIVE_INFINITY) <= t ? "working" : "queued"
}

function cardFor(timeline: Timeline, visit: Visit, t: number): CardModel {
  const base = { id: timeline.task.id, at: t, timeline, stage: visit.stage, enteredAt: visit.enteredAt }
  if (visit.stage === "backlog") {
    return { ...base, phase: "backlog", elapsedMs: t - visit.enteredAt, costUsd: 0, tokens: 0 }
  }
  const stage = visit.stage
  const wait = waitAt(visit, t)
  const phase = phaseOf(visit, t)
  const costUsd = activeBetween(visit, 0, t) * costPerMs(timeline.task.id, stage)
  const startsAt = visit.startsAt ?? visit.startedAt
  const card: CardModel = {
    ...base,
    phase,
    ...(wait && { gate: wait.gate }),
    ...(visit.startedAt ? { startedAt: visit.startedAt } : {}),
    elapsedMs: Math.max(0, t - (phase === "queued" ? visit.enteredAt : (visit.startedAt ?? visit.enteredAt))),
    costUsd,
    tokens: costUsd * tokensPerUsd(stage),
    ...(phase === "queued" && startsAt ? { startsAt } : {}),
    scheduled: Boolean(visit.startsAt),
    ...(phase === "working" && { activity: activityFor(timeline, visit, t) }),
  }
  if (wait?.gate !== "merge") return card
  return {
    ...card,
    costUsd: lifetimeCost(timeline, t),
    tokens: lifetimeTokens(timeline, t),
    elapsedMs: Math.max(0, t - timeline.createdAt),
  }
}

function lifetimeCost(timeline: Timeline, t: number): number {
  let total = 0
  for (const visit of timeline.visits) {
    if (visit.stage === "backlog") continue
    total += activeBetween(visit, 0, t) * costPerMs(timeline.task.id, visit.stage)
  }
  return total
}

function lifetimeTokens(timeline: Timeline, t: number): number {
  let total = 0
  for (const visit of timeline.visits) {
    if (visit.stage === "backlog") continue
    total += activeBetween(visit, 0, t) * costPerMs(timeline.task.id, visit.stage) * tokensPerUsd(visit.stage)
  }
  return total
}

const SYMBOLS = [
  "retryDelay",
  "computeProration",
  "createSession",
  "rankResults",
  "deliverWebhook",
  "seatLimit",
] as const

function jobActivity(task: FactoryTask, file: string, rng: Rng): string {
  if (task.title === "Docs maintenance")
    return pick(rng, [`Updating ${file}`, "Diffing docs against what shipped", "Checking links"])
  if (task.title === "Agent dreaming")
    return pick(rng, ["Reading yesterday’s sessions", "Consolidating memory", "Pruning stale notes"])
  return pick(rng, [
    "Comparing p95 against baseline",
    "Querying PostHog",
    "Reading what merged since 08:00",
    "Checking error rates",
  ])
}

function activityFor(timeline: Timeline, visit: Visit, t: number): string {
  const task = timeline.task
  const area = AREAS[task.area]
  const startedAt = visit.startedAt ?? visit.enteredAt
  const period = (50 + rngFor(task.id, "period")() * 70) * 1000
  const step = Math.floor((t - startedAt) / period)
  const rng = rngFor(task.id, visit.stage, visit.enteredAt, step)
  const file = pick(rng, area.files)
  switch (visit.stage) {
    case "plan":
      return pick(rng, [
        `Reading ${file}`,
        `Tracing callers of ${pick(rng, SYMBOLS)}`,
        `Checking ${file} history`,
        "Drafting the plan",
        `Searching for ${area.tests} tests`,
      ])
    case "build":
      return pick(rng, [
        `Editing ${file}`,
        `Editing ${file}`,
        `Running bun test ${area.tests}`,
        `Fixing a type error in ${file}`,
        "Running typecheck",
      ])
    case "review": {
      const files = 3 + Math.floor(rngFor(task.id, "files")() * 16)
      return step % 3 === 2 ? `Checking ${file}` : `Reviewing ${files} files`
    }
    case "qa": {
      const total = 12 + Math.floor(rngFor(task.id, "e2e")() * 14)
      const span = visit.leftAt ? visit.leftAt - startedAt : 20 * MINUTE
      const progress = Math.min(1, activeBetween(visit, 0, t) / Math.max(span, MINUTE))
      return step % 4 === 3 ? "Recording browser run" : `e2e ${Math.floor(progress * total)} / ${total} passing`
    }
    case "monitoring":
      return jobActivity(task, file, rng)
    case "backlog":
      return ""
  }
}
