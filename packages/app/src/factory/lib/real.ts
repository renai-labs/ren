import type { InsightsRow, SpaceInfo, TaskInfo } from "@ren/client"
import { SPEND_STAGES, TIME_STAGES, type Analytics, type DailyStat } from "./analytics"
import type { BoardModel } from "./board"
import { AREAS, type Area } from "./catalog"
import { hash } from "./rng"
import { DAY, addDays, startOfDay } from "./time"
import type { FactoryTask, FactoryWorld, Source, Stage, Timeline, Visit, WorkStage } from "./types"

type SpendStage = (typeof SPEND_STAGES)[number]

const areas = Object.keys(AREAS).filter((key): key is Area => key in AREAS)

const stagePatterns: ReadonlyArray<readonly [RegExp, WorkStage]> = [
  [/plan/iu, "plan"],
  [/review/iu, "review"],
  [/\bqa\b|test|verif/iu, "qa"],
  [/monitor|release|watch/iu, "monitoring"],
  [/build|code|engineer|implement|dev/iu, "build"],
]

export function stageOfAgent(name: string, index: number): WorkStage {
  return stagePatterns.find((entry) => entry[0].test(name))?.[1] ?? SPEND_STAGES[index] ?? "build"
}

export const usd = (row: InsightsRow) => (row.cost.ren + row.cost.customer) / 1_000_000

export const tokens = (row: InsightsRow) =>
  row.tokens.input + row.tokens.output + row.tokens.reasoning + row.tokens.cacheRead + row.tokens.cacheWrite

const dayOf = (row: InsightsRow) => startOfDay(Date.parse(row.key ?? ""))

function sourceOf(task: TaskInfo): Source {
  const linear = task.links.find((link) => link.kind === "linear_issue")
  const ref = linear && /[A-Z][A-Z0-9]*-\d+/u.exec(linear.url)?.[0]
  if (ref) return { kind: "linear", ref }
  if (task.links.some((link) => link.kind === "slack_thread")) return { kind: "slack", ref: "Thread" }
  return { kind: "ren" }
}

function prOf(task: TaskInfo) {
  const url = task.links.find((link) => link.kind === "github_pr")?.url
  const number = url && /\/pull\/(\d+)/u.exec(url)?.[1]
  return number ? Number(number) : undefined
}

function timelineOf(task: TaskInfo, stage: Stage): Timeline {
  const createdAt = Date.parse(task.createdAt)
  const movedAt = Date.parse(task.updatedAt)
  const working = task.session?.state === "working" || task.status === "in_progress"
  const gate = task.humanReview
    ? ("approve" as const)
    : task.session?.state === "failed"
      ? ("hint" as const)
      : undefined
  const visit: Visit = {
    stage,
    enteredAt: movedAt,
    ...((working || gate) && stage !== "backlog" ? { startedAt: movedAt } : {}),
    waits: gate ? [{ gate, from: movedAt }] : [],
  }
  const factoryTask: FactoryTask = {
    id: task.id,
    number: task.number,
    kind: "work",
    title: task.title,
    label: task.labels.at(0)?.name ?? "task",
    source: sourceOf(task),
    area: areas[hash(task.id) % areas.length] ?? "web",
  }
  const pr = prOf(task)
  return { task: factoryTask, createdAt, visits: [visit], flags: [], ...(pr && { pr }) }
}

export function realWorld(input: {
  now: number
  tasks: ReadonlyArray<TaskInfo>
  stageOf: (agentId: string) => WorkStage | undefined
  startedWorkingAt: number
}): FactoryWorld {
  const timelines = input.tasks.map((task) =>
    timelineOf(task, (task.agentId && input.stageOf(task.agentId)) || "backlog"),
  )
  return {
    now: input.now,
    windowStart: addDays(startOfDay(input.now), -9),
    horizon: input.now,
    startedWorkingAt: input.startedWorkingAt,
    tasks: timelines.map((timeline) => timeline.task),
    events: [],
    timelines,
  }
}

export function withRealSpend(
  board: BoardModel,
  spend: Partial<Record<SpendStage, ReadonlyArray<InsightsRow>>>,
  now: number,
): BoardModel {
  const today = startOfDay(now)
  const next = { ...board }
  for (const stage of SPEND_STAGES) {
    const rows = (spend[stage] ?? []).filter((row) => dayOf(row) === today)
    next[stage] = {
      ...board[stage],
      spentToday: rows.reduce((sum, row) => sum + usd(row), 0),
      tokensToday: rows.reduce((sum, row) => sum + tokens(row), 0),
    }
  }
  return next
}

const sumOf = (days: ReadonlyArray<DailyStat>, pick: (day: DailyStat) => number) =>
  days.reduce((sum, day) => sum + pick(day), 0)

export function realAnalytics(input: {
  now: number
  from: number
  total: ReadonlyArray<InsightsRow>
  byStage: Partial<Record<SpendStage, ReadonlyArray<InsightsRow>>>
  mock: Analytics
}): Analytics {
  const mockPrs = Math.max(
    1,
    sumOf(input.mock.days, (day) => day.prs),
  )
  const perPr = (pick: (day: DailyStat) => number) => sumOf(input.mock.days, pick) / mockPrs
  const ticketsPerPr = perPr((day) => day.tickets)
  const qaPerPr = perPr((day) => day.qaPasses)
  const totals = new Map(input.total.map((row) => [dayOf(row), row]))
  const stageRows = SPEND_STAGES.map(
    (stage) => [stage, new Map((input.byStage[stage] ?? []).map((row) => [dayOf(row), row]))] as const,
  )
  const today = startOfDay(input.now)
  const days: DailyStat[] = []
  for (let day = startOfDay(input.from); day <= today; day = addDays(day, 1)) {
    const prs = totals.get(day)?.prsMerged ?? 0
    const stat: DailyStat = {
      day,
      prs,
      tickets: Math.round(prs * ticketsPerPr),
      qaPasses: Math.round(prs * qaPerPr),
      cost: { plan: 0, build: 0, review: 0, qa: 0, monitoring: 0 },
      tokens: { plan: 0, build: 0, review: 0, qa: 0, monitoring: 0 },
      runs: { plan: 0, build: 0, review: 0, qa: 0, monitoring: 0 },
      stageMs: { plan: 0, build: 0, review: 0, qa: 0, human: 0 },
      incidents: 0,
      recoverMs: 0,
    }
    for (const entry of stageRows) {
      const row = entry[1].get(day)
      stat.cost[entry[0]] = row ? usd(row) : 0
      stat.tokens[entry[0]] = row ? tokens(row) : 0
      stat.runs[entry[0]] = Math.round(prs * perPr((mock) => mock.runs[entry[0]]))
    }
    for (const stage of TIME_STAGES) stat.stageMs[stage] = prs * perPr((mock) => mock.stageMs[stage])
    days.push(stat)
  }
  const active = days.find(
    (day) =>
      day.prs > 0 || SPEND_STAGES.some((stage) => day.cost[stage] > 0) || (totals.get(day.day)?.tasksDone ?? 0) > 0,
  )
  return {
    days,
    now: input.now,
    startedWorkingAt: active?.day ?? today,
    monthlyBudget: input.mock.monthlyBudget,
  }
}

export const gridStart = (now: number) => {
  const today = startOfDay(now)
  return addDays(addDays(today, -new Date(today).getDay()), -51 * 7)
}

export const gridEnd = (now: number) => startOfDay(now) + DAY

export const isSoftwareFactory = (space: SpaceInfo) => /software factory/iu.test(space.name)
