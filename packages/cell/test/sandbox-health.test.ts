import { describe, expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, Layer, Logger } from "effect"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SandboxHealth } from "../src/sandbox-health.js"

const it = testEffect(Layer.empty)

describe("SandboxHealth", () => {
  it.live("reports a process's last exit once, then only the processes that the sandbox kills for lack of memory", () =>
    Effect.gen(function* () {
      const state = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ren-health-")))
      const memoryEvents = join(state, "memory.events")
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(join(state, "brain.exit"), "137\n"),
          Bun.write(memoryEvents, "low 0\nhigh 0\nmax 4\noom 2\noom_kill 2\n"),
        ]),
      )
      const errors: Array<{ readonly message: unknown; readonly type: string | undefined }> = []
      const check = yield* SandboxHealth.make({ state, memoryEvents })
      const run = check.pipe(
        Effect.provide(
          Logger.layer([
            Logger.make((log) => {
              if (log.logLevel === "Error")
                errors.push({ message: log.message, type: log.cause.reasons.at(0)?._tag === "Die" ? "Die" : undefined })
            }),
          ]),
        ),
      )

      yield* run
      yield* Effect.promise(() => Bun.write(memoryEvents, "low 0\nhigh 0\nmax 4\noom 3\noom_kill 3\n"))
      yield* run
      yield* run

      expect(errors.map((error) => [error.message, error.type])).toEqual([
        [["The brain exited with code 137 (SIGKILL)"], "Die"],
        [["The sandbox killed 1 process for lack of memory"], "Die"],
      ])
      expect(yield* Effect.promise(() => Bun.file(join(state, "brain.exit")).exists())).toBe(false)
    }),
  )

  it.live("reports a brain that the watchdog stopped once, as stuck and not as an exit", () =>
    Effect.gen(function* () {
      const state = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ren-health-")))
      yield* Effect.promise(() =>
        Promise.all([Bun.write(join(state, "brain.stuck"), "120\n"), Bun.write(join(state, "brain.exit"), "137\n")]),
      )
      const errors: Array<{ readonly message: unknown; readonly name: unknown }> = []
      const check = yield* SandboxHealth.make({ state, memoryEvents: join(state, "memory.events") })
      const run = check.pipe(
        Effect.provide(
          Logger.layer([
            Logger.make((log) => {
              const reason = log.cause.reasons.at(0)
              if (log.logLevel === "Error")
                errors.push({
                  message: log.message,
                  name: reason?._tag === "Die" && reason.defect instanceof Error ? reason.defect.name : undefined,
                })
            }),
          ]),
        ),
      )

      yield* run
      yield* run

      expect(errors).toEqual([
        { message: ["The brain did not answer for 120 s; the sandbox restarted it"], name: "BrainStuck" },
      ])
    }),
  )
})
