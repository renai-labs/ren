import { expect } from "bun:test"
import { Processes, testEffect } from "@ren/executor/testing"
import { Effect, Exit, Schedule, Scope } from "effect"
import { join } from "node:path"
import { Pid } from "./lib/pid.js"
import { RemoteHost } from "./lib/remote-host.js"
import { Shared } from "./lib/shared.js"

const stub = Shared.stub()

const it = testEffect(RemoteHost.served)

// oxlint-disable-next-line ren/no-comments -- OpenCode runs a command in a detached fiber, so a host close leaves it to the executor's 30 second heartbeat rule (accepted for v1).
it.live(
  "a command that runs when the host closes stops on the sandbox within 35 seconds, when its heartbeats stop",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const opened = yield* RemoteHost.open().pipe(Scope.provide(scope))
      const session = yield* RemoteHost.begin(opened)
      const pidFile = join(RemoteHost.workspace, `${crypto.randomUUID()}.pid`)
      yield* session.send(stub.script(RemoteHost.shell(`echo $$ > ${pidFile}; exec sleep 120`)))
      const pid = yield* Pid.read(pidFile)
      const closedAt = performance.now()
      yield* Scope.close(scope, Exit.void).pipe(Effect.timeout("15 seconds"))
      yield* Effect.sync(() => Processes.running(pid)).pipe(
        Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced(250) }),
        Effect.timeout("40 seconds"),
        Effect.ensuring(Effect.sync(() => Processes.running(pid) && process.kill(pid, "SIGKILL"))),
      )
      expect(performance.now() - closedAt).toBeLessThan(35_000)
    }),
  60_000,
)
