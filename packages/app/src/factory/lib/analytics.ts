import { rngFor, between } from "./rng"
import { costPerMs, tokensPerUsd } from "./simulate"
import { DAY, addDays, isWeekend, startOfDay, startOfMonth, startOfWeek, startOfYear } from "./time"
import { activeBetween, visitAt } from "./timeline"
import type { FactoryWorld, HumanGate, Timeline, Visit } from "./types"

export const SPEND_STAGES = ["plan", "build", "review", "qa", "monitoring"] as const
type SpendStage = (typeof SPEND_STAGES)[number]
export const TIME_STAGES = ["plan", "build", "review", "qa", "human"] as const
type TimeStage = (typeof TIME_STAGES)[number]

type ByStage<K extends string> = Record<K, number>

export type DailyStat = {
  day: number
  prs: number
  tickets: number
  qaPasses: number
  cost: ByStage<SpendStage>
  tokens: ByStage<SpendStage>
  runs: ByStage<SpendStage>
  stageMs: ByStage<TimeStage>
  incidents: number
  recoverMs: number
}

const emptySpend = (): ByStage<SpendStage> => ({ plan: 0, build: 0, review: 0, qa: 0, monitoring: 0 })
const emptyTime = (): ByStage<TimeStage> => ({ plan: 0, build: 0, review: 0, qa: 0, human: 0 })

function fill<K extends string>(target: ByStage<K>, stages: readonly K[], value: (stage: K) => number) {
  for (const stage of stages) target[stage] = value(stage)
  return target
}

function emptyDay(day: number): DailyStat {
  return {
    day,
    prs: 0,
    tickets: 0,
    qaPasses: 0,
    cost: emptySpend(),
    tokens: emptySpend(),
    runs: emptySpend(),
    stageMs: emptyTime(),
    incidents: 0,
    recoverMs: 0,
  }
}

type DayOf = (t: number) => DailyStat

const inWindow = (world: FactoryWorld, t: number) => t >= world.windowStart && t <= world.now

function recordVisit(world: FactoryWorld, timeline: Timeline, visit: Visit, dayOf: DayOf) {
  const now = world.now
  if (visit.stage === "backlog" || !visit.startedAt || visit.startedAt > now) return
  const stage = visit.stage
  if (visit.startedAt >= world.windowStart) dayOf(visit.startedAt).runs[stage]++
  const end = Math.min(visit.leftAt ?? now, now)
  for (let d = Math.max(startOfDay(visit.startedAt), world.windowStart); d <= end; d = addDays(d, 1)) {
    const active = activeBetween(visit, d, Math.min(addDays(d, 1), now))
    if (active <= 0) continue
    const cost = active * costPerMs(timeline.task.id, stage)
    const stat = dayOf(d)
    stat.cost[stage] += cost
    stat.tokens[stage] += cost * tokensPerUsd(stage)
  }
  if (stage === "qa" && visit.leftAt && inWindow(world, visit.leftAt)) dayOf(visit.leftAt).qaPasses++
}

function recordOutcome(world: FactoryWorld, timeline: Timeline, dayOf: DayOf) {
  const merge = mergedAt(timeline)
  if (merge && inWindow(world, merge)) {
    const stat = dayOf(merge)
    stat.prs++
    addTicketTime(stat.stageMs, timeline, merge)
  }
  if (!timeline.task.incident || !inWindow(world, timeline.createdAt)) return
  const stat = dayOf(timeline.createdAt)
  stat.incidents++
  const resolved = timeline.visits.at(0)?.waits.at(0)?.to
  if (resolved && resolved <= world.now) stat.recoverMs += resolved - timeline.createdAt
}

function simulatedDays(world: FactoryWorld): DailyStat[] {
  const days = new Map<number, DailyStat>()
  const dayOf = (t: number) => {
    const key = startOfDay(t)
    const existing = days.get(key)
    if (existing) return existing
    const stat = emptyDay(key)
    days.set(key, stat)
    return stat
  }
  for (let d = world.windowStart; d <= world.now; d = addDays(d, 1)) dayOf(d)

  for (const timeline of world.timelines) {
    const plan = timeline.visits.find((visit) => visit.stage === "plan")
    if (plan && inWindow(world, plan.enteredAt)) dayOf(plan.enteredAt).tickets++
    for (const visit of timeline.visits) recordVisit(world, timeline, visit, dayOf)
    recordOutcome(world, timeline, dayOf)
  }
  return [...days.values()].toSorted((a, b) => a.day - b.day)
}

function mergedAt(timeline: Timeline): number | undefined {
  for (const visit of timeline.visits) {
    const merged = visit.waits.find((wait) => wait.gate === "merge" && wait.resolution === "merge")
    if (merged) return merged.to
  }
  return undefined
}

function addTicketTime(target: ByStage<TimeStage>, timeline: Timeline, until: number) {
  for (const visit of timeline.visits) {
    if (visit.enteredAt >= until) break
    const end = Math.min(visit.leftAt ?? until, until)
    let waited = 0
    for (const wait of visit.waits) waited += Math.max(0, Math.min(wait.to ?? end, end) - wait.from)
    target.human += waited
    if (visit.stage === "plan" || visit.stage === "build" || visit.stage === "review" || visit.stage === "qa") {
      target[visit.stage] += Math.max(0, end - visit.enteredAt - waited)
    }
  }
}

function syntheticDays(world: FactoryWorld, recent: DailyStat[]): DailyStat[] {
  const weekdays = recent.filter((stat) => !isWeekend(stat.day) && stat.prs > 0)
  const sample = weekdays.length > 0 ? weekdays : recent
  const mean = (pick: (stat: DailyStat) => number) =>
    sample.reduce((sum, stat) => sum + pick(stat), 0) / Math.max(1, sample.length)
  const prs = mean((s) => s.prs)
  const perPr = {
    tickets: mean((s) => s.tickets) / Math.max(1, prs),
    qa: mean((s) => s.qaPasses) / Math.max(1, prs),
    cost: fill(emptySpend(), SPEND_STAGES, (k) => mean((s) => s.cost[k]) / Math.max(1, prs)),
    runs: fill(emptySpend(), SPEND_STAGES, (k) => mean((s) => s.runs[k]) / Math.max(1, prs)),
    time: fill(emptyTime(), TIME_STAGES, (k) => mean((s) => s.stageMs[k]) / Math.max(1, prs)),
  }
  const out: DailyStat[] = []
  const start = world.startedWorkingAt
  for (let day = start; day < world.windowStart; day = addDays(day, 1)) {
    const rng = rngFor("history", day)
    const weeks = (day - start) / (7 * DAY)
    const ramp = Math.min(1, 0.25 + weeks / 8)
    const weekend = isWeekend(day) ? between(rng, 0.15, 0.35) : 1
    const noise = between(rng, 0.7, 1.25)
    const count = Math.round(prs * ramp * weekend * noise)
    const slower = 1 + 0.35 * Math.max(0, 1 - weeks / 26)
    const stat = emptyDay(day)
    stat.prs = count
    stat.tickets = Math.round(count * perPr.tickets * between(rng, 0.85, 1.15))
    stat.qaPasses = Math.round(count * perPr.qa * between(rng, 0.85, 1.15))
    for (const stage of SPEND_STAGES) {
      stat.cost[stage] = count * perPr.cost[stage] * between(rng, 0.8, 1.2) * slower
      stat.tokens[stage] = stat.cost[stage] * (stage === "monitoring" ? 110_000 : 123_000)
      stat.runs[stage] = Math.round(count * perPr.runs[stage] * between(rng, 0.9, 1.1))
    }
    for (const stage of TIME_STAGES) stat.stageMs[stage] = count * perPr.time[stage] * between(rng, 0.85, 1.15) * slower
    if (rng() < 0.06) {
      stat.incidents = 1
      stat.recoverMs = between(rng, 20, 95) * 60_000
    }
    out.push(stat)
  }
  return out
}

export type Analytics = {
  days: DailyStat[]
  now: number
  startedWorkingAt: number
  monthlyBudget: number
}

export function buildAnalytics(world: FactoryWorld): Analytics {
  const recent = simulatedDays(world)
  const days = [...syntheticDays(world, recent), ...recent]
  const now = world.now
  const monthStart = startOfMonth(now)
  const monthSpend = sumCost(days.filter((d) => d.day >= monthStart))
  const lastWeek = days.filter((d) => d.day >= addDays(startOfDay(now), -7) && d.day < startOfDay(now))
  const daily = sumCost(lastWeek) / Math.max(1, lastWeek.length)
  const monthEnd = addDays(monthStart, 32)
  const daysLeft = (startOfMonth(monthEnd) - now) / DAY
  const monthlyBudget = Math.ceil(((monthSpend + daily * daysLeft) * 0.93) / 50) * 50
  return { days, now, startedWorkingAt: world.startedWorkingAt, monthlyBudget }
}

export function totalCost(stat: DailyStat): number {
  return SPEND_STAGES.reduce((sum, stage) => sum + stat.cost[stage], 0)
}

function sumCost(days: DailyStat[]): number {
  return days.reduce((sum, day) => sum + totalCost(day), 0)
}

export const PERIODS = [
  { id: "today", label: "Today", phrase: "today" },
  { id: "week", label: "This week", phrase: "this week" },
  { id: "month", label: "This month", phrase: "this month" },
  { id: "quarter", label: "Last 3 months", phrase: "in the last 3 months" },
  { id: "year", label: "This year", phrase: "this year" },
  { id: "all", label: "All time", phrase: "all time" },
] as const
export type PeriodId = (typeof PERIODS)[number]["id"]

function periodStart(id: PeriodId, analytics: Analytics): number {
  const now = analytics.now
  switch (id) {
    case "today":
      return startOfDay(now)
    case "week":
      return startOfWeek(now)
    case "month":
      return startOfMonth(now)
    case "quarter":
      return addDays(startOfDay(now), -90)
    case "year":
      return Math.max(startOfYear(now), analytics.startedWorkingAt)
    case "all":
      return analytics.startedWorkingAt
  }
}

export function periodRange(
  id: PeriodId,
  analytics: Analytics,
): { from: number; to: number; previous?: { from: number; to: number } } {
  const to = analytics.now
  const from = periodStart(id, analytics)
  if (id === "all") return { from, to }
  const length = to - from
  return { from, to, previous: { from: from - length, to: from } }
}

export type PeriodSummary = {
  prs: number
  tickets: number
  qaPasses: number
  cost: ByStage<SpendStage>
  tokens: ByStage<SpendStage>
  runs: ByStage<SpendStage>
  stageMs: ByStage<TimeStage>
}

export function summarize(analytics: Analytics, from: number, to: number): PeriodSummary {
  const out: PeriodSummary = {
    prs: 0,
    tickets: 0,
    qaPasses: 0,
    cost: emptySpend(),
    tokens: emptySpend(),
    runs: emptySpend(),
    stageMs: emptyTime(),
  }
  for (const day of analytics.days) {
    const dayEnd = addDays(day.day, 1)
    if (dayEnd <= from || day.day >= to) continue
    const share = day.day >= from ? 1 : (dayEnd - from) / (dayEnd - day.day)
    out.prs += day.prs * share
    out.tickets += day.tickets * share
    out.qaPasses += day.qaPasses * share
    for (const stage of SPEND_STAGES) {
      out.cost[stage] += day.cost[stage] * share
      out.tokens[stage] += day.tokens[stage] * share
      out.runs[stage] += day.runs[stage] * share
    }
    for (const stage of TIME_STAGES) out.stageMs[stage] += day.stageMs[stage] * share
  }
  return out
}

export type NeedsYouItem = {
  id: string
  icon:
    | "budget"
    | "incident"
    | "hallucination"
    | "approval"
    | "merge"
    | "blocked"
    | "finding"
    | "spend"
    | "backlog"
    | "loop"
  title: string
  detail: string
  href?: string
}

function refOf(timeline: Timeline): string {
  const source = timeline.task.source
  if (source.kind === "linear" || source.kind === "sentry") return source.ref
  return timeline.pr ? `#${timeline.pr}` : timeline.task.title
}

function since(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

type Wait = Visit["waits"][number]
type Waiting = { t: Timeline; wait: Wait }

function budgetItem(analytics: Analytics): NeedsYouItem {
  const now = analytics.now
  const monthDays = analytics.days.filter((d) => d.day >= startOfMonth(now))
  const spent = sumCost(monthDays)
  const build = monthDays.reduce((sum, d) => sum + d.cost.build, 0)
  const recent = analytics.days.filter((d) => d.day >= addDays(startOfDay(now), -7) && d.day < startOfDay(now))
  const daily = sumCost(recent) / Math.max(1, recent.length)
  const runsOutAt = now + ((analytics.monthlyBudget - spent) / Math.max(daily, 1)) * DAY
  const runsOut =
    runsOutAt - now < 6 * DAY
      ? new Date(runsOutAt).toLocaleDateString("en-US", { weekday: "long" })
      : `on ${new Date(runsOutAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
  return {
    id: "budget",
    icon: "budget",
    title: runsOutAt - now < DAY ? "Budget runs out today" : `Budget runs out ${runsOut}`,
    detail: `$${Math.round(spent).toLocaleString("en-US")} of $${analytics.monthlyBudget.toLocaleString("en-US")} used this month · Build is ${Math.round((build / Math.max(spent, 1)) * 100)}% of spend`,
  }
}

function incidentItems(world: FactoryWorld, findings: Waiting[]): NeedsYouItem[] {
  const now = world.now
  const incident =
    findings.find((f) => f.t.task.incident) ??
    world.timelines
      .filter((t) => t.task.incident && t.createdAt <= now && now - t.createdAt < DAY)
      .flatMap((t) => {
        const wait = t.visits.at(0)?.waits.at(0)
        return wait ? [{ t, wait }] : []
      })
      .reduce<Waiting | undefined>(
        (latest, entry) => (!latest || entry.t.createdAt > latest.t.createdAt ? entry : latest),
        undefined,
      )
  if (!incident) return []
  const recoveredAt = incident.wait.to
  const item: NeedsYouItem = {
    id: incident.t.task.id,
    icon: "incident",
    title: incident.t.task.title,
    detail:
      recoveredAt && recoveredAt <= now
        ? `Recovered in ${since(recoveredAt - incident.t.createdAt)} · sent to Plan`
        : `${incident.t.task.incident?.summary ?? ""} for ${since(now - incident.t.createdAt)}`,
  }
  return [item]
}

function queueItems(now: number, merges: Waiting[], approvals: Waiting[]): NeedsYouItem[] {
  const items: NeedsYouItem[] = []
  const oldestMerge = merges.at(0)
  if (oldestMerge) {
    items.push({
      id: "merges",
      icon: "merge",
      title: `${merges.length} pull ${merges.length === 1 ? "request is" : "requests are"} ready to merge`,
      detail: `QA verified ${merges.length === 1 ? "it" : "them"} · oldest has waited ${since(now - oldestMerge.wait.from)}`,
    })
  }
  const oldestApproval = approvals.at(0)
  if (oldestApproval) {
    items.push({
      id: "approvals",
      icon: "approval",
      title: `${approvals.length} ${approvals.length === 1 ? "plan needs" : "plans need"} your approval`,
      detail: `${refOf(oldestApproval.t)} has waited ${since(now - oldestApproval.wait.from)} · Build starts once you approve`,
    })
  }
  return items
}

function troubleItems(world: FactoryWorld, live: Timeline[]): NeedsYouItem[] {
  const now = world.now
  const items: NeedsYouItem[] = []
  const flagged = world.timelines
    .flatMap((t) => t.flags.filter((f) => f.at <= now && now - f.at < 3 * DAY).map((f) => ({ t, f })))
    .reduce<{ t: Timeline; f: Timeline["flags"][number] } | undefined>(
      (latest, entry) => (!latest || entry.f.at > latest.f.at ? entry : latest),
      undefined,
    )
  if (flagged) {
    items.push({
      id: `flag-${flagged.t.task.id}`,
      icon: "hallucination",
      title: `Hallucination in ${refOf(flagged.t)}`,
      detail: flagged.f.note,
    })
  }
  const looping = live
    .map((t) => ({ t, rounds: t.visits.filter((v) => v.stage === "build").length }))
    .filter((entry) => entry.rounds >= 3)
    .reduce<{ t: Timeline; rounds: number } | undefined>(
      (most, entry) => (!most || entry.rounds > most.rounds ? entry : most),
      undefined,
    )
  if (looping) {
    items.push({
      id: `loop-${looping.t.task.id}`,
      icon: "loop",
      title: `${refOf(looping.t)} keeps coming back to Build`,
      detail: `${looping.rounds} rounds so far · Review and QA keep finding problems`,
    })
  }
  return items
}

function spendItems(analytics: Analytics): NeedsYouItem[] {
  const today = startOfDay(analytics.now)
  const thisWeek = analytics.days.filter((d) => d.day >= addDays(today, -7))
  const lastWeek = analytics.days.filter((d) => d.day >= addDays(today, -14) && d.day < addDays(today, -7))
  const buildNow = thisWeek.reduce((sum, d) => sum + d.cost.build, 0)
  const buildBefore = lastWeek.reduce((sum, d) => sum + d.cost.build, 0)
  if (buildBefore <= 0 || buildNow / buildBefore <= 1.1) return []
  const item: NeedsYouItem = {
    id: "spend",
    icon: "spend",
    title: `Build spend is up ${Math.round((buildNow / buildBefore - 1) * 100)}% on last week`,
    detail: `$${Math.round(buildNow).toLocaleString("en-US")} in the last 7 days against $${Math.round(buildBefore).toLocaleString("en-US")}`,
  }
  return [item]
}

export function needsYou(world: FactoryWorld, analytics: Analytics): NeedsYouItem[] {
  const now = world.now
  const live = world.timelines.filter((t) => t.createdAt <= now && (!t.doneAt || t.doneAt > now))
  const waiting = (gate: HumanGate) =>
    live
      .flatMap((t) => {
        const wait = visitAt(t, now)?.waits.find((w) => w.gate === gate && w.from <= now && (!w.to || w.to > now))
        return wait ? [{ t, wait }] : []
      })
      .toSorted((a, b) => a.wait.from - b.wait.from)
  const findings = waiting("triage")
  const stale = live.filter((t) => visitAt(t, now)?.stage === "backlog" && now - t.createdAt > 2 * DAY)
  const backlog: NeedsYouItem[] =
    stale.length > 0
      ? [
          {
            id: "backlog",
            icon: "backlog",
            title: `${stale.length} backlog ${stale.length === 1 ? "item is" : "items are"} older than 2 days`,
            detail: "Send them to Plan or let them go",
          },
        ]
      : []
  return [
    budgetItem(analytics),
    ...incidentItems(world, findings),
    ...findings
      .filter((f) => !f.t.task.incident)
      .slice(0, 2)
      .map((finding): NeedsYouItem => ({
        id: finding.t.task.id,
        icon: "finding",
        title: finding.t.task.title,
        detail: `Release monitoring flagged it ${since(now - finding.wait.from)} ago · dismiss it or send it to Plan`,
      })),
    ...queueItems(now, waiting("merge"), waiting("approve")),
    ...waiting("hint")
      .slice(0, 1)
      .map((blocked): NeedsYouItem => ({
        id: `hint-${blocked.t.task.id}`,
        icon: "blocked",
        title: `Build is stuck on ${blocked.t.task.title}`,
        detail: `Waiting on a hint for ${since(now - blocked.wait.from)}`,
      })),
    ...waiting("account")
      .slice(0, 1)
      .map((account): NeedsYouItem => ({
        id: `account-${account.t.task.id}`,
        icon: "blocked",
        title: `QA needs a test account for ${account.t.task.title}`,
        detail: `Paused for ${since(now - account.wait.from)} · add one and QA picks it back up`,
      })),
    ...troubleItems(world, live),
    ...spendItems(analytics),
    ...backlog,
  ]
}

export type GridCell = {
  day: number
  col: number
  row: number
  stat?: DailyStat
  future: boolean
  beforeStart: boolean
}

export function contributionGrid(analytics: Analytics): {
  cells: GridCell[]
  startedCol: number
  levels: { low: number; mid: number; high: number }
} {
  const today = startOfDay(analytics.now)
  const sunday = addDays(today, -new Date(today).getDay())
  const first = addDays(sunday, -51 * 7)
  const byDay = new Map(analytics.days.map((d) => [d.day, d]))
  const cells: GridCell[] = []
  for (let col = 0; col < 52; col++) {
    for (let row = 0; row < 7; row++) {
      const day = addDays(first, col * 7 + row)
      const stat = byDay.get(day)
      cells.push({
        day,
        col,
        row,
        ...(stat && { stat }),
        future: day > today,
        beforeStart: day < analytics.startedWorkingAt,
      })
    }
  }
  const counts = analytics.days
    .map((d) => d.prs)
    .filter((n) => n > 0)
    .toSorted((a, b) => a - b)
  const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] ?? 1
  const startedCol = Math.floor((startOfDay(analytics.startedWorkingAt) - first) / (7 * DAY))
  return { cells, startedCol, levels: { low: q(0.3), mid: q(0.6), high: q(0.88) } }
}
