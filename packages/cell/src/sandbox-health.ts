export * as SandboxHealth from "./sandbox-health.js"

import { Cause, Effect, Option, Ref } from "effect"
import { readFile, rm } from "node:fs/promises"
import { constants } from "node:os"
import { join } from "node:path"

const text = (path: string) =>
  Effect.promise(() => readFile(path, "utf8").then(Option.some, () => Option.none<string>()))

const oomKills = (memoryEvents: string) =>
  Effect.map(text(memoryEvents), (found) =>
    Option.flatMap(found, (events) =>
      Option.fromNullishOr(/^oom_kill (\d+)$/mu.exec(events)?.at(1)).pipe(Option.map(Number)),
    ),
  )

const failure = (name: string, message: string) => Cause.die(Object.assign(new Error(message), { name }))

export const make = (options: { readonly state: string; readonly memoryEvents: string }) =>
  Effect.map(Effect.flatMap(oomKills(options.memoryEvents), Ref.make), (seen) =>
    Effect.gen(function* () {
      for (const process of ["brain", "executor"]) {
        const file = join(options.state, `${process}.exit`)
        const exit = yield* text(file)
        if (Option.isNone(exit)) continue
        yield* Effect.promise(() => rm(file, { force: true }))
        const code = Number(exit.value.trim())
        const signal = Object.entries(constants.signals)
          .find((entry) => entry.at(1) === code - 128)
          ?.at(0)
        const message = `The ${process} exited with code ${code}${signal ? ` (${signal})` : ""}`
        yield* Effect.logError(message, failure("ProcessExited", message))
      }
      const now = yield* oomKills(options.memoryEvents)
      const before = yield* Ref.getAndSet(seen, now)
      const killed = Option.getOrElse(
        Option.zipWith(now, before, (current, previous) => current - previous),
        () => 0,
      )
      if (killed > 0) {
        const message = `The sandbox killed ${killed} ${killed === 1 ? "process" : "processes"} for lack of memory`
        yield* Effect.logError(message, failure("OutOfMemory", message))
      }
    }),
  )
