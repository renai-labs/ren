export * as Watchdog from "./watchdog.js"

import type { Shell as OpenCodeShell } from "@opencode/schema/shell"
import { Duration, Effect, FiberMap, Option, Schedule, Schema, type Scope, Stream } from "effect"

export type Shell = Pick<OpenCodeShell.Info, "id" | "pid" | "command">

export interface Memory {
  readonly usedBytes: number
  readonly limitBytes: number
  readonly processes: ReadonlyArray<{ readonly pid: number; readonly rssBytes: number }>
}

export interface Settings {
  readonly stallAfter: Duration.Duration
  readonly sampleEvery: Duration.Duration
  readonly high: number
}

export const defaults: Settings = {
  stallAfter: Duration.minutes(5),
  sampleEvery: Duration.seconds(5),
  high: 0.8,
}

interface Notice {
  readonly sessionID: string
  readonly text: string
  readonly description: string
}

export interface Options {
  readonly events: Stream.Stream<{ readonly type: string; readonly data: unknown }>
  readonly shells: (sessionID: string) => Effect.Effect<ReadonlyArray<Shell>>
  readonly memory: (sessionID: string) => Effect.Effect<Option.Option<Memory>>
  readonly background: (sessionID: string) => Effect.Effect<void>
  readonly notify: (notice: Notice) => Effect.Effect<void>
  readonly settings?: Partial<Settings>
}

const sessionOf = Schema.decodeUnknownOption(Schema.Struct({ sessionID: Schema.String }))

const ended = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"])

const steps = new Set(["session.step.started", "session.step.ended"])

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`

export const run = Effect.fn("Watchdog.run")(function* (options: Options): Effect.fn.Return<void, never, Scope.Scope> {
  const settings = { ...defaults, ...options.settings }
  const timers = yield* FiberMap.make<string>()
  const busy = new Set<string>()
  const watched = new Set<string>()
  const told = new Set<string>()
  const minutes = Duration.toMinutes(settings.stallAfter)

  const stalled = Effect.fn("Watchdog.stalled")(function* (sessionID: string) {
    const shell = (yield* options.shells(sessionID)).at(0)
    if (!shell) return
    yield* options.background(sessionID)
    yield* options.notify({
      sessionID,
      text: `\`${shell.command}\` was moved to the background after ${minutes} minutes without progress. You get a notice when it ends; do other work or end your turn, and tell the person if they are waiting on it.`,
      description: `Still running \`${shell.command}\` (${minutes} min). Moved to the background.`,
    })
  })

  const arm = (sessionID: string) =>
    FiberMap.run(
      timers,
      sessionID,
      Effect.sleep(settings.stallAfter).pipe(
        Effect.andThen(stalled(sessionID)),
        Effect.catchCause((cause) =>
          Effect.logWarning("The watchdog could not background a stalled session", { sessionID, cause }),
        ),
      ),
    )

  const sample = Effect.fn("Watchdog.sample")(function* (sessionID: string) {
    const shells = yield* options.shells(sessionID)
    if (shells.length === 0) {
      if (!busy.has(sessionID)) watched.delete(sessionID)
      return
    }
    const found = yield* options.memory(sessionID)
    if (Option.isNone(found)) return
    const memory = found.value
    const ratio = memory.usedBytes / memory.limitBytes
    if (ratio < settings.high) {
      told.delete(sessionID)
      return
    }
    if (told.has(sessionID)) return
    told.add(sessionID)
    const rss = (shell: Shell) => memory.processes.find((process) => process.pid === shell.pid)?.rssBytes ?? 0
    yield* options.notify({
      sessionID,
      text: `Memory is at ${percent(ratio)} of the ${megabytes(memory.limitBytes)} limit; ${shells.map((shell) => `\`${shell.command}\` uses ${megabytes(rss(shell))}`).join(", ")}. At the limit the system stops the largest process.`,
      description: `Memory is at ${percent(ratio)} of the limit.`,
    })
  })

  yield* Effect.suspend(() =>
    Effect.forEach(
      [...watched],
      (sessionID) =>
        sample(sessionID).pipe(
          Effect.catchCause((cause) => Effect.logWarning("The watchdog could not sample memory", { sessionID, cause })),
        ),
      { discard: true },
    ),
  ).pipe(Effect.repeat(Schedule.spaced(settings.sampleEvery)), Effect.withErrorReporting, Effect.forkScoped)

  yield* options.events.pipe(
    Stream.runForEach((event) => {
      const sessionID = Option.getOrUndefined(sessionOf(event.data))?.sessionID
      if (!sessionID) return Effect.void
      if (event.type === "session.execution.started") {
        busy.add(sessionID)
        watched.add(sessionID)
        return arm(sessionID)
      }
      if (steps.has(event.type)) return busy.has(sessionID) ? arm(sessionID) : Effect.void
      if (ended.has(event.type)) {
        busy.delete(sessionID)
        return FiberMap.remove(timers, sessionID)
      }
      if (event.type === "session.deleted") {
        busy.delete(sessionID)
        watched.delete(sessionID)
        told.delete(sessionID)
        return FiberMap.remove(timers, sessionID)
      }
      return Effect.void
    }),
    Effect.withErrorReporting,
    Effect.forkScoped,
  )
})
