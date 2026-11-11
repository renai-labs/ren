export * as Watchdog from "./watchdog.js"

import type { Shell as OpenCodeShell } from "@opencode/schema/shell"
import { Duration, Effect, FiberMap, Option, Schema, type Scope, Stream } from "effect"

export type Shell = Pick<OpenCodeShell.Info, "id" | "pid" | "command">

export interface Settings {
  readonly stallAfter: Duration.Duration
}

export const defaults: Settings = {
  stallAfter: Duration.minutes(5),
}

interface Notice {
  readonly sessionID: string
  readonly text: string
  readonly description: string
}

export interface Options {
  readonly events: Stream.Stream<{ readonly type: string; readonly data: unknown }>
  readonly shells: (sessionID: string) => Effect.Effect<ReadonlyArray<Shell>>
  readonly background: (sessionID: string) => Effect.Effect<void>
  readonly notify: (notice: Notice) => Effect.Effect<void>
  readonly settings?: Partial<Settings>
}

const sessionOf = Schema.decodeUnknownOption(Schema.Struct({ sessionID: Schema.String }))

const ended = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"])

const steps = new Set(["session.step.started", "session.step.ended"])

export const run = Effect.fn("Watchdog.run")(function* (options: Options): Effect.fn.Return<void, never, Scope.Scope> {
  const settings = { ...defaults, ...options.settings }
  const timers = yield* FiberMap.make<string>()
  const busy = new Set<string>()
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

  yield* options.events.pipe(
    Stream.runForEach((event) => {
      const sessionID = Option.getOrUndefined(sessionOf(event.data))?.sessionID
      if (!sessionID) return Effect.void
      if (event.type === "session.execution.started") {
        busy.add(sessionID)
        return arm(sessionID)
      }
      if (steps.has(event.type)) return busy.has(sessionID) ? arm(sessionID) : Effect.void
      if (ended.has(event.type)) {
        busy.delete(sessionID)
        return FiberMap.remove(timers, sessionID)
      }
      if (event.type === "session.deleted") {
        busy.delete(sessionID)
        return FiberMap.remove(timers, sessionID)
      }
      return Effect.void
    }),
    Effect.withErrorReporting,
    Effect.forkScoped,
  )
})
