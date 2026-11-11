import { expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Processes, testEffect } from "@ren/executor/testing"
import { BrainRejectedError } from "@ren/host-api/errors"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Path } from "effect"
import { CodeUpdate } from "../src/code-update.js"

const it = testEffect(BunServices.layer)

const updater = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const home = yield* fs.makeTempDirectoryScoped()
  const script = path.join(home, "start.ts")
  yield* fs.writeFileString(script, "process.exit(0)\n")
  yield* fs.makeDirectory(path.join(home, ".ren"))
  yield* fs.writeFileString(path.join(home, ".ren", "brain.version"), "current\n")
  return yield* Layer.build(CodeUpdate.layerProcess({ home, script, version: "current", restart: Effect.void })).pipe(
    Effect.map((context) => Context.get(context, CodeUpdate.Service)),
  )
})

it.live("a failed update drains large stderr and reports only its final diagnostic", () =>
  Effect.gen(function* () {
    const code = yield* updater
    const failure = yield* code
      .update(
        [],
        [
          {
            user: "user",
            command: "head -c 4194304 /dev/zero | tr '\\000' x >&2; printf 'last diagnostic' >&2; exit 1",
          },
        ],
      )
      .pipe(Effect.flip)
    expect(failure).toBeInstanceOf(BrainRejectedError)
    expect(failure.message).toEndWith("last diagnostic")
    expect(failure.message.length).toBeLessThan(800)
  }),
)

it.live("interrupting an update stops its command and child processes before the update scope closes", () =>
  Effect.gen(function* () {
    const code = yield* updater
    const entered = yield* Deferred.make<number>()
    const childEntered = yield* Deferred.make<number>()
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: async (request) => {
            Effect.runSync(
              Deferred.succeed(
                new URL(request.url).pathname === "/child" ? childEntered : entered,
                Number(await request.text()),
              ),
            )
            return new Response("started")
          },
        }),
      ),
      (opened) => Effect.sync(() => opened.stop(true)),
    )
    const update = yield* code
      .update(
        [],
        [
          {
            user: "user",
            command: `sh -c 'curl -fsS --data "$$" ${server.url.href}child; exec sleep 60' & curl -fsS --data "$$" ${server.url.href}; wait`,
          },
        ],
      )
      .pipe(Effect.forkScoped)
    const pid = yield* Deferred.await(entered)
    const child = yield* Deferred.await(childEntered)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (Processes.running(pid)) process.kill(pid, "SIGKILL")
        if (Processes.running(child)) process.kill(child, "SIGKILL")
      }),
    )
    expect(Processes.running(pid)).toBe(true)
    expect(Processes.running(child)).toBe(true)
    yield* Fiber.interrupt(update)
    expect(Processes.running(pid)).toBe(false)
    expect(Processes.running(child)).toBe(false)
  }),
)
