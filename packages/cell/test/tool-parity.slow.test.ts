import { expect, setDefaultTimeout, test } from "bun:test"
import { Processes, testEffect } from "@ren/executor/testing"
import { Effect, Exit, Schedule, Scope, type Layer } from "effect"
import { join } from "node:path"
import { Pid } from "./lib/pid.js"
import { Shared } from "./lib/shared.js"
import { RemoteHost } from "./lib/remote-host.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

const it = testEffect(RemoteHost.served)

const live = <A, E>(body: Effect.Effect<A, E, Layer.Success<typeof RemoteHost.served> | Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(RemoteHost.served), Effect.runPromise)

it.live("J24 a command that ignores SIGTERM is killed with SIGKILL 3 seconds after the time-out", () =>
  Effect.gen(function* () {
    const opened = yield* RemoteHost.open()
    const session = yield* RemoteHost.begin(opened)
    const dir = yield* RemoteHost.scratch()
    const started = Date.now()
    const answer = yield* session.turn(
      stub.script(
        RemoteHost.shellWith(`trap '' TERM; echo $$ > ${dir}/main; while true; do sleep 1; done`, { timeout: 2000 }),
      ),
    )
    const took = Date.now() - started
    expect(RemoteHost.lastToolResult(answer)).toContain("Command exceeded timeout of 2000 ms")
    expect(took).toBeGreaterThanOrEqual(4800)
    expect(took).toBeLessThan(15_000)
    expect(yield* RemoteHost.stops(yield* Pid.read(join(dir, "main")), 30)).toBe(true)
  }),
)

test(
  "J30 a command with no timeout and no output for 35 seconds, longer than the executor's 30 second orphan time, continues and returns",
  () =>
    live(
      Effect.gen(function* () {
        const opened = yield* RemoteHost.open()
        const session = yield* RemoteHost.begin(opened)
        const answer = yield* session.turn(stub.script(RemoteHost.shellWith("sleep 35; echo woke", { timeout: 0 })))
        expect(RemoteHost.lastToolResult(answer)).toBe(JSON.stringify("woke\n"))
      }),
    ),
  90_000,
)

// oxlint-disable-next-line ren/no-comments -- A background job of an idle session stops one executor scan after the orphan time. OpenCode runs a command in a detached fiber, so a host close leaves a running command to the executor's 30 second heartbeat rule (accepted for v1). One close covers both.
const closedHostStops = (seconds: { readonly background: number; readonly foreground: number }) =>
  live(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const opened = yield* RemoteHost.open().pipe(Effect.provideService(Scope.Scope, scope))
      const background = yield* RemoteHost.begin(opened)
      const foreground = yield* RemoteHost.begin(opened)
      const dir = yield* RemoteHost.scratch()
      const answer = yield* background.turn(
        stub.script(RemoteHost.shellWith(`echo $$ > ${dir}/background; exec sleep 300`, { background: true })),
      )
      expect(RemoteHost.lastToolResult(answer)).toContain("Command moved to the background")
      const backgroundPid = yield* Pid.read(join(dir, "background"))
      yield* RemoteHost.idle(opened, background.sessionId).pipe(
        Effect.repeat({ until: Boolean, schedule: Schedule.spaced("100 millis") }),
      )
      expect(Processes.running(backgroundPid)).toBe(true)
      yield* foreground.send(stub.script(RemoteHost.shell(`echo $$ > ${dir}/foreground; exec sleep 120`)))
      const foregroundPid = yield* Pid.read(join(dir, "foreground"))
      yield* Scope.close(scope, Exit.void).pipe(Effect.timeout("15 seconds"))
      const stopped = yield* Effect.all(
        [RemoteHost.stops(backgroundPid, seconds.background), RemoteHost.stops(foregroundPid, seconds.foreground)],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.ensuring(
          Effect.forEach(
            [backgroundPid, foregroundPid],
            (pid) => Effect.sync(() => Processes.running(pid) && process.kill(pid, "SIGKILL")),
            { discard: true },
          ),
        ),
      )
      expect(stopped).toEqual([true, true])
    }),
  )

test(
  "J28 when the host closes, a background job of an idle session stops on the sandbox within the executor's orphan time and one scan, and a running command within 35 seconds",
  () => closedHostStops({ background: 33, foreground: 35 }),
  90_000,
)

test.todo("J28 a background job stops on the sandbox 30 seconds or less after the idle cell closes", () =>
  closedHostStops({ background: 30, foreground: 35 }))
