import { ALERTS, HALLUCINATIONS, INCIDENTS, JOBS, TEMPLATES, type Template } from "./catalog.js"
import { between, hash, pick, poisson, rngFor, ulid, type Rng } from "./rng.js"
import { DAY, HOUR, MINUTE, addDays, isWeekend, localHour, startOfDay } from "./time.js"
import { buildTimelines } from "./timeline.js"
import type {
  FactoryTask,
  FactoryTaskEvent,
  FactoryWorld,
  HumanGate,
  Resolution,
  ResolvedBy,
  Source,
  Stage,
  VisitorAction,
  WorkStage,
} from "./types.js"

const HISTORY_DAYS = 9
const WARMUP_DAYS = 2
const HORIZON = 8 * HOUR
const STARTED_WORKING_WEEKS = 30

const CAPACITY: Record<WorkStage, number> = {
  plan: 2,
  build: 3,
  review: 2,
  qa: 2,
  monitoring: Number.POSITIVE_INFINITY,
}

const DURATION_MINUTES: Partial<Record<WorkStage, { min: number; max: number }>> = {
  plan: { min: 8, max: 32 },
  build: { min: 25, max: 110 },
  review: { min: 8, max: 30 },
  qa: { min: 10, max: 45 },
}

const COST_PER_MINUTE: Record<WorkStage, number> = {
  plan: 0.15,
  build: 0.13,
  review: 0.2,
  qa: 0.1,
  monitoring: 0.06,
}

const TOKENS_PER_USD: Record<WorkStage, number> = {
  plan: 131_000,
  build: 122_000,
  review: 118_000,
  qa: 126_000,
  monitoring: 110_000,
}

export function costPerMs(taskId: string, stage: WorkStage): number {
  const jitter = 0.75 + 0.5 * rngFor("rate", taskId, stage)()
  return (COST_PER_MINUTE[stage] * jitter) / MINUTE
}

export function tokensPerUsd(stage: WorkStage): number {
  return TOKENS_PER_USD[stage]
}

function awakeReplyMinutes(from: number, rng: Rng): number | undefined {
  const hour = localHour(from)
  const weekend = isWeekend(from)
  if (!weekend && hour >= 9 && hour < 19) return between(rng, 3, 45, 1.8)
  if (!weekend && hour >= 19 && hour < 23 && rng() < 0.7) return between(rng, 15, 90, 1.5)
  if (weekend && hour >= 9 && hour < 22 && rng() < 0.7) return between(rng, 20, 150, 1.5)
  return undefined
}

function humanDelay(from: number, rng: Rng): number {
  const awake = awakeReplyMinutes(from, rng)
  if (awake) return from + awake * MINUTE
  if (rng() < 0.55) return from + between(rng, 30, 120, 1.5) * MINUTE
  const morning = startOfDay(from) + 9 * HOUR
  return (localHour(from) >= 9 ? addDays(morning, 1) : morning) + between(rng, 5, 60, 1.6) * MINUTE
}

function arrivalRate(t: number): number {
  const hour = localHour(t)
  if (isWeekend(t)) return hour >= 10 && hour < 20 ? 0.8 : 0.3
  if (hour >= 9 && hour < 19) return 2.4
  if (hour >= 7 && hour < 23) return 1
  return 0.4
}

function arrivalsBetween(from: number, to: number): Array<{ at: number; key: string }> {
  const arrivals: Array<{ at: number; key: string }> = []
  for (let h = Math.floor(from / HOUR); h <= Math.floor(to / HOUR); h++) {
    const slotStart = h * HOUR
    const rng = rngFor("arrivals", h)
    const count = poisson(rng, arrivalRate(slotStart))
    for (let i = 0; i < count; i++) arrivals.push({ at: slotStart + rng() * HOUR, key: `arrival-${h}-${i}` })
  }
  return arrivals.toSorted((a, b) => a.at - b.at)
}

function sourceFor(template: Template, key: string, rng: Rng): Source {
  if (template.label === "ren-fix" || template.label === "ren-improve") return { kind: "ren" }
  if (template.label === "bug" && rng() < 0.4)
    return { kind: "sentry", ref: `API-${(hash(key) % 1200).toString(36).toUpperCase()}` }
  if (rng() < 0.22) return { kind: "slack", ref: "#support" }
  return { kind: "linear", ref: "" }
}

type Phase = "backlog" | "queued" | "working" | "waiting" | "done"

type PendingGate = { gate: HumanGate; afterMs: number }

type Run = {
  task: FactoryTask
  stage: Stage
  phase: Phase
  gate?: HumanGate | undefined
  token: number
  remainingMs: number
  segmentStart: number
  activeMs: number
  pendingGate?: PendingGate | undefined
  visits: Partial<Record<Stage, number>>
  reviewRounds: number
  qaRounds: number
  holdsSlot: boolean
  pr?: number
}

type EventInput<Event = FactoryTaskEvent> = Event extends FactoryTaskEvent ? Pick<Event, "type" | "data"> : never

type Outcome = Extract<FactoryTaskEvent, { type: "task.done" }>["data"]["outcome"]

type Job = { at: number; seq: number; run: () => void }

class Heap {
  private items: Job[] = []
  push(job: Job) {
    const items = this.items
    items.push(job)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      const child = items[i]
      const above = items[parent]
      if (!child || !above || !before(child, above)) break
      items[i] = above
      items[parent] = child
      i = parent
    }
  }
  pop(): Job | undefined {
    const items = this.items
    const top = items.at(0)
    const last = items.pop()
    if (items.length === 0 || !last) return top
    items.splice(0, 1, last)
    const earlier = (a: number, b: number) => {
      const left = items[a]
      const right = items[b]
      return left && right && before(left, right) ? a : b
    }
    let i = 0
    for (;;) {
      const m = earlier(i * 2 + 2, earlier(i * 2 + 1, i))
      const parent = items[i]
      const child = items[m]
      if (m === i || !parent || !child) break
      items[i] = child
      items[m] = parent
      i = m
    }
    return top
  }
}

function shuffled(templates: readonly Template[], rng: Rng): Template[] {
  const items = [...templates]
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = items[i]
    const b = items[j]
    if (!a || !b) continue
    items[i] = b
    items[j] = a
  }
  return items
}

function before(a: Job, b: Job) {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq)
}

function startedWorkingAt(now: number): number {
  return startOfDay(now - STARTED_WORKING_WEEKS * 7 * DAY)
}

export function simulate(now: number, actions: VisitorAction[] = []): FactoryWorld {
  const windowStart = startOfDay(now) - HISTORY_DAYS * DAY
  const simStart = windowStart - WARMUP_DAYS * DAY
  const horizon = now + HORIZON
  const dayIndex = Math.floor(simStart / DAY)
  const engBase = 240 + (dayIndex % 360) * 4
  let prCounter = 180 + (dayIndex % 360) * 3
  let taskCounter = 0
  let eventCounter = 0
  let seq = 0

  const heap = new Heap()
  const tasks: FactoryTask[] = []
  const events: FactoryTaskEvent[] = []
  const runs = new Map<string, Run>()
  const queues: Record<WorkStage, Run[]> = { plan: [], build: [], review: [], qa: [], monitoring: [] }
  const active: Record<WorkStage, number> = { plan: 0, build: 0, review: 0, qa: 0, monitoring: 0 }

  const schedule = (at: number, run: () => void) => {
    if (at > horizon) return
    heap.push({ at, seq: seq++, run })
  }

  const emit = (run: Run, at: number, event: EventInput) => {
    events.push({ id: `evt_${ulid(at, run.task.id, eventCounter)}`, taskId: run.task.id, at, ...event })
    eventCounter++
  }

  const createTask = (at: number, key: string, fields: Omit<FactoryTask, "id" | "number">): Run => {
    const task: FactoryTask = { ...fields, id: `task_${ulid(at, key)}`, number: engBase + taskCounter++ }
    if (task.source.kind === "linear" && task.source.ref === "")
      task.source = { kind: "linear", ref: `ENG-${task.number}` }
    tasks.push(task)
    const run: Run = {
      task,
      stage: "backlog",
      phase: "backlog",
      token: 0,
      remainingMs: 0,
      segmentStart: at,
      activeMs: 0,
      visits: {},
      reviewRounds: 0,
      qaRounds: 0,
      holdsSlot: false,
    }
    runs.set(task.id, run)
    return run
  }

  const taskRng = (run: Run, ...parts: Array<string | number>) => rngFor(run.task.id, ...parts)
  const visitOf = (run: Run) => run.visits[run.stage] ?? 1

  const enter = (run: Run, stage: WorkStage, at: number, startsAt?: number) => {
    run.stage = stage
    run.phase = "queued"
    run.gate = undefined
    run.visits[stage] = (run.visits[stage] ?? 0) + 1
    emit(run, at, { type: "task.queued", data: startsAt ? { stage, startsAt } : { stage } })
  }

  const enqueue = (run: Run, stage: WorkStage, at: number, startsAt?: number) => {
    enter(run, stage, at, startsAt)
    if (startsAt) {
      const token = ++run.token
      schedule(startsAt, () => {
        if (run.token === token) start(run, startsAt)
      })
      return
    }
    queues[stage].push(run)
    pump(stage, at)
  }

  const pump = (stage: WorkStage, at: number) => {
    while (active[stage] < CAPACITY[stage]) {
      const next = queues[stage].shift()
      if (!next) return
      start(next, at)
    }
  }

  const durationFor = (run: Run, stage: WorkStage, rng: Rng) => {
    const job = run.task.kind === "job" ? JOBS.find((j) => j.title === run.task.title) : undefined
    if (job) return between(rng, job.minutes.min, job.minutes.max) * MINUTE
    const range = DURATION_MINUTES[stage] ?? { min: 10, max: 30 }
    const rework = visitOf(run) > 1 ? 0.45 : 1
    return between(rng, range.min, range.max, 1.4) * MINUTE * rework
  }

  const plannedGate = (run: Run, stage: WorkStage, rng: Rng): PendingGate | undefined => {
    if (run.task.kind !== "work") return undefined
    if (stage === "plan") return { gate: "approve", afterMs: run.remainingMs }
    if (stage === "build" && visitOf(run) === 1 && rng() < 0.12)
      return { gate: "hint", afterMs: run.remainingMs * between(rng, 0.3, 0.7) }
    if (stage === "qa" && run.qaRounds === 0 && rng() < 0.08)
      return { gate: "account", afterMs: run.remainingMs * between(rng, 0.2, 0.5) }
    return undefined
  }

  const start = (run: Run, at: number) => {
    const stage = run.stage
    if (stage === "backlog") return
    active[stage]++
    run.holdsSlot = true
    run.phase = "working"
    run.activeMs = 0
    if (stage === "build" && !run.pr) run.pr = prCounter++
    emit(run, at, { type: "task.started", data: run.pr && stage !== "plan" ? { stage, pr: run.pr } : { stage } })
    const rng = taskRng(run, "work", stage, visitOf(run))
    run.remainingMs = durationFor(run, stage, rng)
    run.pendingGate = plannedGate(run, stage, rng)
    work(run, at)
  }

  const work = (run: Run, at: number) => {
    run.segmentStart = at
    const token = ++run.token
    const pending = run.pendingGate
    if (pending) {
      const gateAt = at + pending.afterMs
      schedule(gateAt, () => {
        if (run.token !== token) return
        const elapsed = gateAt - run.segmentStart
        run.activeMs += elapsed
        run.remainingMs -= elapsed
        run.pendingGate = undefined
        needsHuman(run, gateAt, pending.gate)
      })
      return
    }
    const doneAt = at + run.remainingMs
    schedule(doneAt, () => {
      if (run.token !== token) return
      run.activeMs += doneAt - run.segmentStart
      complete(run, doneAt)
    })
  }

  const releaseSlot = (run: Run, at: number) => {
    if (!run.holdsSlot || run.stage === "backlog") return
    run.holdsSlot = false
    active[run.stage]--
    pump(run.stage, at)
  }

  const needsHuman = (run: Run, at: number, gate: HumanGate) => {
    releaseSlot(run, at)
    if (run.stage === "backlog") return
    run.phase = "waiting"
    run.gate = gate
    emit(run, at, { type: "task.needs_human", data: { stage: run.stage, gate } })
    const rng = taskRng(run, "human", gate, visitOf(run), Math.round(at))
    const token = ++run.token
    const resolveAt = humanDelay(at, rng)
    const resolution = teamResolution(run, gate, rng)
    schedule(resolveAt, () => {
      if (run.token === token) resolve(run, resolveAt, resolution, "team")
    })
  }

  const teamResolution = (run: Run, gate: HumanGate, rng: Rng): Resolution => {
    if (gate === "approve") return rng() < 0.82 ? "approve" : "request_changes"
    if (gate === "merge") return visitOf(run) <= 2 && rng() < 0.12 ? "request_changes" : "merge"
    if (gate === "triage") return run.task.incident || rng() < 0.6 ? "send_to_plan" : "dismiss"
    return gate
  }

  const accepts = (gate: HumanGate, resolution: Resolution) => {
    if (gate === "approve" || gate === "merge") return resolution === gate || resolution === "request_changes"
    if (gate === "triage") return resolution === "dismiss" || resolution === "send_to_plan"
    return gate === resolution
  }

  const reopenPullRequest = (run: Run, at: number) => {
    run.visits.build = (run.visits.build ?? 1) + 1
    run.remainingMs = between(taskRng(run, "pr-change", visitOf(run)), 8, 30) * MINUTE
    run.pendingGate = { gate: "merge", afterMs: run.remainingMs }
    run.activeMs = 0
    active.build++
    run.holdsSlot = true
    run.phase = "working"
    emit(run, at, { type: "task.started", data: run.pr ? { stage: "build", pr: run.pr } : { stage: "build" } })
    work(run, at)
  }

  const resolve = (run: Run, at: number, resolution: Resolution, by: ResolvedBy, note?: string) => {
    if (run.phase !== "waiting" || !run.gate || run.stage === "backlog") return
    const gate = run.gate
    if (!accepts(gate, resolution)) return
    run.token++
    run.gate = undefined
    const stage = run.stage
    emit(run, at, {
      type: "task.human_resolved",
      data: note ? { stage, gate, resolution, by, note } : { stage, gate, resolution, by },
    })

    if (gate === "merge") {
      if (resolution === "merge") return finish(run, at, "merged")
      return reopenPullRequest(run, at)
    }
    if (gate === "triage") {
      emit(run, at, {
        type: "task.stage_completed",
        data: {
          stage,
          costUsd: 0,
          tokens: 0,
          activeMs: 0,
          ...(resolution === "send_to_plan" && { next: "plan" }),
        },
      })
      if (resolution === "dismiss") return finish(run, at, "dismissed")
      run.task.kind = "work"
      enqueue(run, "plan", at)
      return
    }
    if (resolution === "request_changes") {
      run.remainingMs = between(taskRng(run, "changes", at), 5, 15) * MINUTE
      run.pendingGate = { gate: "approve", afterMs: run.remainingMs }
    }
    active[stage]++
    run.holdsSlot = true
    run.phase = "working"
    work(run, at)
  }

  const complete = (run: Run, at: number) => {
    const stage = run.stage
    if (stage === "backlog") return
    const costUsd = run.activeMs * costPerMs(run.task.id, stage)
    const next = nextStage(run, stage)
    emit(run, at, {
      type: "task.stage_completed",
      data: {
        stage,
        costUsd: Math.round(costUsd * 100) / 100,
        tokens: Math.round(costUsd * tokensPerUsd(stage)),
        activeMs: Math.round(run.activeMs),
        ...(next && { next: next === "ready" ? "build" : next }),
      },
    })
    releaseSlot(run, at)
    if (stage === "review" && next === "build" && taskRng(run, "flag", run.reviewRounds)() < 0.3) {
      emit(run, at, {
        type: "task.flagged",
        data: { stage, kind: "hallucination", note: pick(taskRng(run, "note"), HALLUCINATIONS) },
      })
    }
    if (run.task.kind === "job") return finishJob(run, at)
    if (next === "ready") {
      enter(run, "build", at)
      needsHuman(run, at, "merge")
      return
    }
    if (next) enqueue(run, next, at)
  }

  const nextStage = (run: Run, stage: WorkStage): WorkStage | "ready" | undefined => {
    switch (stage) {
      case "plan":
        return "build"
      case "build":
        return "review"
      case "review": {
        run.reviewRounds++
        const blocking =
          run.reviewRounds < 3 && taskRng(run, "review", run.reviewRounds)() < (run.reviewRounds === 1 ? 0.2 : 0.08)
        if (blocking) return "build"
        return run.task.label === "docs" ? "ready" : "qa"
      }
      case "qa": {
        run.qaRounds++
        const failed = run.qaRounds < 3 && taskRng(run, "qa", run.qaRounds)() < 0.12
        return failed ? "build" : "ready"
      }
      case "monitoring":
        return undefined
    }
  }

  const finishJob = (run: Run, at: number) => {
    finish(run, at, "completed")
    if (run.task.title !== "Release monitoring") return
    const rng = taskRng(run, "finding")
    if (rng() > 0.22) return
    const incident = rng() < 0.15 ? pick(rng, INCIDENTS) : undefined
    const alert = pick(rng, ALERTS)
    const finding = createTask(at, `${run.task.id}-finding`, {
      kind: "alert",
      title: incident?.title ?? alert.title,
      label: incident ? "infra" : alert.label,
      source: { kind: "slack", ref: alert.channel },
      area: incident ? "infra" : alert.area,
      ...(incident && { incident: { summary: incident.summary } }),
      parentId: run.task.id,
    })
    finding.stage = "monitoring"
    finding.visits.monitoring = 1
    emit(finding, at, { type: "task.created", data: { stage: "monitoring" } })
    needsHuman(finding, at, "triage")
  }

  const finish = (run: Run, at: number, outcome: Outcome) => {
    run.phase = "done"
    run.token++
    emit(run, at, { type: "task.done", data: { outcome } })
  }

  const arrive = (at: number, key: string, rng: Rng, template: Template) => {
    const renFiled = template.label === "ren-fix" || template.label === "ren-improve"
    const run = createTask(at, key, {
      kind: "work",
      title: template.title,
      label: template.label,
      source: sourceFor(template, key, rng),
      area: template.area,
    })
    const toBacklog = rng() < (renFiled ? 0.75 : 0.2)
    if (!toBacklog) {
      emit(run, at, { type: "task.created", data: { stage: "plan" } })
      enqueue(run, "plan", at)
      return
    }
    emit(run, at, { type: "task.created", data: { stage: "backlog" } })
    const token = ++run.token
    if (rng() < 0.55) {
      const promoteAt = humanDelay(at + between(rng, 1, 20) * HOUR, rng)
      schedule(promoteAt, () => {
        if (run.token === token && run.phase === "backlog") promote(run, promoteAt, "team")
      })
    } else {
      const archiveAt = at + between(rng, 2, 4) * DAY
      schedule(archiveAt, () => {
        if (run.token === token && run.phase === "backlog") finish(run, archiveAt, "archived")
      })
    }
  }

  const reorder = (run: Run, at: number, before?: string) => {
    if (run.phase === "backlog") {
      emit(run, at, {
        type: "task.reordered",
        data: before ? { stage: "backlog", before, by: "visitor" } : { stage: "backlog", by: "visitor" },
      })
      return
    }
    if (run.phase !== "queued" || run.stage === "backlog") return
    const queue = queues[run.stage]
    const from = queue.indexOf(run)
    if (from < 0) return
    queue.splice(from, 1)
    const target = before ? queue.findIndex((other) => other.task.id === before) : -1
    queue.splice(target < 0 ? queue.length : target, 0, run)
    emit(run, at, {
      type: "task.reordered",
      data: before ? { stage: run.stage, before, by: "visitor" } : { stage: run.stage, by: "visitor" },
    })
  }

  const promote = (run: Run, at: number, by: ResolvedBy) => {
    run.token++
    emit(run, at, {
      type: "task.human_resolved",
      data: { stage: "backlog", gate: "triage_backlog", resolution: "promote", by },
    })
    enqueue(run, "plan", at)
  }

  const order = shuffled(TEMPLATES, rngFor("templates", dayIndex))
  for (const [ordinal, arrival] of arrivalsBetween(simStart, horizon).entries()) {
    const template = order[ordinal % order.length]
    if (template) schedule(arrival.at, () => arrive(arrival.at, arrival.key, rngFor(arrival.key), template))
  }

  for (let day = startOfDay(simStart); day <= horizon; day = addDays(day, 1)) {
    for (const job of JOBS) {
      for (const hour of job.hours) {
        const startsAt = day + hour * HOUR
        const queuedAt = startsAt - 4 * HOUR + MINUTE
        const key = `job-${job.title}-${startsAt}`
        schedule(queuedAt, () => {
          const run = createTask(queuedAt, key, {
            kind: "job",
            title: job.title,
            label: job.label,
            source: { kind: "ren" },
            area: job.area,
            scheduledFor: startsAt,
          })
          run.stage = "monitoring"
          emit(run, queuedAt, { type: "task.created", data: { stage: "monitoring" } })
          enqueue(run, "monitoring", queuedAt, startsAt)
        })
      }
    }
  }

  for (const action of actions) {
    if (action.at < simStart || action.at > horizon) continue
    schedule(action.at, () => {
      const run = runs.get(action.taskId)
      if (!run) return
      if (action.resolution === "promote") {
        if (run.phase === "backlog") promote(run, action.at, "visitor")
        return
      }
      if (action.resolution === "reorder") {
        reorder(run, action.at, action.before)
        return
      }
      resolve(run, action.at, action.resolution, "visitor", action.note)
    })
  }

  for (let job = heap.pop(); job; job = heap.pop()) job.run()

  const timelines = buildTimelines(tasks, events)
  return { now, windowStart, horizon, startedWorkingAt: startedWorkingAt(now), tasks, events, timelines }
}
