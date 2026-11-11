import { expect, setDefaultTimeout, test } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Effect, type Layer, type Scope } from "effect"
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
