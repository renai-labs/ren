import { expect } from "bun:test"
import { TestHand, testEffect } from "@ren/executor/testing"
import { Effect, Exit, Schedule, Scope } from "effect"
import { join } from "node:path"
import { FrozenSandbox } from "./lib/frozen-sandbox.js"
import { Pid } from "./lib/pid.js"
import { RemoteHost } from "./lib/remote-host.js"
import { Shared } from "./lib/shared.js"

const stub = Shared.stub()

const it = testEffect(RemoteHost.served)

it.live(
  "an interrupt during a command on a frozen sandbox ends in the kill's limit and leaves the session idle",
  () =>
    Effect.gen(function* () {
      const opened = yield* RemoteHost.open()
      const frozen = yield* FrozenSandbox.make
      const session = yield* RemoteHost.begin(opened, frozen.url)
      const pidFile = join(RemoteHost.workspace, `${crypto.randomUUID()}.pid`)
      yield* session.send(stub.script(RemoteHost.shell(`echo $$ > ${pidFile}; exec sleep 60`)))
      const pid = yield* Pid.read(pidFile)
      yield* frozen.freeze
      const own = (yield* opened.harness.sessions).find((state) => String(state.id) === session.sessionId)
      expect(own).toBeDefined()
      if (!own) return
      const startedAt = performance.now()
      yield* own.interrupt.pipe(
        Effect.andThen(own.wait(12_000)),
        Effect.ensuring(Effect.sync(() => void Bun.spawnSync(["kill", "-9", String(pid)]))),
      )
      expect(performance.now() - startedAt).toBeLessThan(10_000)
      expect(yield* RemoteHost.idle(opened, session.sessionId)).toBe(true)
    }),
  60_000,
)

it.live(
  "closing the host during a command on a frozen sandbox completes in its limit, and a later turn works",
  () =>
    Effect.gen(function* () {
      const frozen = yield* FrozenSandbox.make
      const scope = yield* Scope.make()
      const first = yield* RemoteHost.open().pipe(Scope.provide(scope))
      const session = yield* RemoteHost.begin(first, frozen.url)
      const pidFile = join(RemoteHost.workspace, `${crypto.randomUUID()}.pid`)
      yield* session.send(stub.script(RemoteHost.shell(`echo $$ > ${pidFile}; exec sleep 60`)))
      const pid = yield* Pid.read(pidFile)
      yield* frozen.freeze
      const startedAt = performance.now()
      yield* Scope.close(scope, Exit.void).pipe(
        Effect.timeout("12 seconds"),
        Effect.ensuring(Effect.sync(() => void Bun.spawnSync(["kill", "-9", String(pid)]))),
      )
      expect(performance.now() - startedAt).toBeLessThan(10_000)
      yield* frozen.thaw
      const second = yield* RemoteHost.open()
      const later = yield* RemoteHost.begin(second, frozen.url)
      expect(RemoteHost.lastToolResult(yield* later.turn(stub.script(RemoteHost.shell("echo back"))))).toBe(
        JSON.stringify("back\n"),
      )
    }),
  60_000,
)

it.live(
  "removing a session's access lets a running command finish, fails a call with no access once the token is due for refresh, and access back restores tools",
  () =>
    Effect.gen(function* () {
      const opened = yield* RemoteHost.open()
      const session = yield* RemoteHost.begin(opened)
      const url = yield* TestHand.url
      const access = yield* RemoteHost.accessTo(url, session.sessionId)
      yield* opened.memory.set(
        session.sessionId,
        yield* RemoteHost.accessTo(url, session.sessionId, { lifetimeMs: 6_000 }),
      )
      const pidFile = join(RemoteHost.workspace, `${crypto.randomUUID()}.pid`)
      const running = stub.script(
        RemoteHost.shell(`echo $$ > ${pidFile}; while [ ! -e ${pidFile}.go ]; do sleep 0.01; done; echo finished`),
      )
      yield* session.send(running)
      yield* Pid.read(pidFile)
      yield* opened.memory.remove(session.sessionId)
      yield* Effect.promise(() => Bun.write(`${pidFile}.go`, ""))
      const finished = RemoteHost.lastToolResult(yield* Effect.promise(() => running.called(2)))
      const refused = yield* Effect.gen(function* () {
        const marker = join(RemoteHost.workspace, `${crypto.randomUUID()}.ran`)
        const result = RemoteHost.lastToolResult(yield* session.turn(stub.script(RemoteHost.shell(`touch ${marker}`))))
        return { result, ran: yield* Effect.promise(() => Bun.file(marker).exists()) }
      }).pipe(
        Effect.repeat({
          until: (attempt) => attempt.result.includes("No access to an environment"),
          schedule: Schedule.spaced(500),
        }),
        Effect.timeout("15 seconds"),
      )
      yield* opened.memory.set(session.sessionId, access)
      const back = RemoteHost.lastToolResult(yield* session.turn(stub.script(RemoteHost.shell("echo back"))))
      expect({
        finished,
        ran: refused.ran,
        noAccess: refused.result.includes("No access to an environment"),
        back,
      }).toEqual({
        finished: JSON.stringify("finished\n"),
        ran: false,
        noAccess: true,
        back: JSON.stringify("back\n"),
      })
    }),
  60_000,
)
