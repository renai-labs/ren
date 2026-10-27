import type { Area } from "./catalog.js"

export const STAGES = ["backlog", "plan", "build", "review", "qa", "monitoring"] as const
export type Stage = (typeof STAGES)[number]
export type WorkStage = Exclude<Stage, "backlog">

export const STAGE_TITLES: Record<Stage, string> = {
  backlog: "Backlog",
  plan: "Plan",
  build: "Build",
  review: "Review",
  qa: "QA",
  monitoring: "Monitoring",
}

export type LabelName =
  | "api"
  | "billing"
  | "bug"
  | "feature"
  | "web"
  | "docs"
  | "perf"
  | "ren-fix"
  | "ren-improve"
  | "infra"
  | "ops"
  | "memory"

export type Source =
  | { kind: "linear"; ref: string }
  | { kind: "sentry"; ref: string }
  | { kind: "slack"; ref: string }
  | { kind: "ren" }

type TaskKind = "work" | "alert" | "job"

export type FactoryTask = {
  id: string
  number: number
  kind: TaskKind
  title: string
  label: LabelName
  source: Source
  area: Area
  incident?: { summary: string }
  parentId?: string
  scheduledFor?: number
}

export type HumanGate = "approve" | "hint" | "account" | "merge" | "triage"

export const RESOLUTIONS = [
  "approve",
  "request_changes",
  "hint",
  "account",
  "merge",
  "dismiss",
  "send_to_plan",
  "promote",
  "reorder",
] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export type ResolvedBy = "visitor" | "team"

type EventBase<T extends string, D> = { id: string; taskId: string; at: number; type: T; data: D }

export type FactoryTaskEvent =
  | EventBase<"task.created", { stage: Stage }>
  | EventBase<"task.queued", { stage: WorkStage; startsAt?: number }>
  | EventBase<"task.started", { stage: WorkStage; pr?: number }>
  | EventBase<"task.needs_human", { stage: WorkStage; gate: HumanGate }>
  | EventBase<
      "task.human_resolved",
      { stage: Stage; gate: HumanGate | "triage_backlog"; resolution: Resolution; by: ResolvedBy; note?: string }
    >
  | EventBase<
      "task.stage_completed",
      { stage: WorkStage; costUsd: number; tokens: number; activeMs: number; next?: WorkStage }
    >
  | EventBase<"task.reordered", { stage: Stage; before?: string; by: ResolvedBy }>
  | EventBase<"task.flagged", { stage: WorkStage; kind: "hallucination"; note: string }>
  | EventBase<"task.done", { outcome: "merged" | "dismissed" | "archived" | "completed" }>

export type FactoryEventType = FactoryTaskEvent["type"]

export type VisitorAction = {
  id: string
  at: number
  taskId: string
  before?: string
  resolution: Resolution
  note?: string
}

type Wait = { gate: HumanGate; from: number; to?: number; resolution?: Resolution; by?: ResolvedBy }

export type Visit = {
  stage: Stage
  enteredAt: number
  startsAt?: number
  startedAt?: number
  leftAt?: number
  waits: Wait[]
  costUsd?: number
  tokens?: number
  activeMs?: number
}

export type Timeline = {
  task: FactoryTask
  createdAt: number
  doneAt?: number
  outcome?: Extract<FactoryTaskEvent, { type: "task.done" }>["data"]["outcome"]
  pr?: number
  visits: Visit[]
  flags: Array<{ at: number; note: string }>
}

export type FactoryWorld = {
  now: number
  windowStart: number
  horizon: number
  startedWorkingAt: number
  tasks: FactoryTask[]
  events: FactoryTaskEvent[]
  timelines: Timeline[]
}
