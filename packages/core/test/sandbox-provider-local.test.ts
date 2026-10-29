import { expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SandboxProvider } from "../src/sandbox-provider.js"
import { LocalSandbox } from "../src/sandbox-provider/local.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Layer.empty)

const Pid = Schema.Struct({ pid: Schema.Int })

const groupAlive = (pid: number) =>
  Effect.sync(() => Effect.runSyncExit(Effect.try(() => process.kill(-pid, 0)))._tag === "Success")

// oxlint-disable-next-line ren/no-comments -- A test process that dies without cleanup (timeout, abort, kill) must not leave its brains restarting forever, also when a brain is paused.
it.live("a brain whose owner process dies is killed with its whole process group, also when it is paused", () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "ren-local-sandbox-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    )
    const idle = join(root, "idle.ts")
    yield* Effect.promise(() => Bun.write(idle, "setInterval(() => {}, 1000)\n"))
    const owner = Bun.spawn(["sleep", "600"], { stdio: ["ignore", "ignore", "ignore"] })
    yield* Effect.addFinalizer(() => Effect.sync(() => owner.kill("SIGKILL")))
    const pids = yield* Effect.gen(function* () {
      const provider = yield* SandboxProvider.Service
      const create = (generation: number) =>
        provider.create({
          brainId: Brain.ID.create(),
          generation,
          organizationId: Auth.OrganizationID.create(),
          spaceId: Space.ID.create(),
          env: {},
          proxy: Option.none(),
        })
      const running = yield* create(1)
      const paused = yield* create(2)
      yield* provider.keepAlive(paused.binding, Duration.zero)
      yield* provider
        .status(paused.binding)
        .pipe(Effect.repeat({ until: (status) => status === "paused", schedule: Schedule.spaced("10 millis") }))
      return yield* Effect.forEach([running, paused], (created) =>
        Effect.map(Schema.decodeUnknownEffect(Pid)(created.binding), (binding) => binding.pid),
      )
    }).pipe(Effect.provide(LocalSandbox.layer({ entry: idle, executor: idle, root, owner: owner.pid })))
    expect(yield* Effect.forEach(pids, groupAlive)).toEqual([true, true])
    owner.kill("SIGKILL")
    yield* Effect.forEach(pids, groupAlive).pipe(
      Effect.repeat({ until: (alive) => alive.every((each) => !each), schedule: Schedule.spaced("100 millis") }),
      Effect.timeout(Duration.seconds(5)),
    )
  }),
)
