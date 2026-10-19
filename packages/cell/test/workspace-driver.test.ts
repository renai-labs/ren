import { expect } from "bun:test"
import { TestAccess } from "@ren/brain/testing"
import { EnvironmentFiles } from "@opencode/core/environment/files"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { HandConnections } from "@ren/brain/hand-connections"
import { Sandbox, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import type { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { mkdtemp, realpath, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { maxFileBytes } from "@ren/hand-api/executor-api"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "workspace-driver-")))
const it = testEffect(Sandbox.layer({ environmentId, workspace }))

const sessionFor = Effect.fnUntraced(function* (accesses: ReadonlyMap<Session.ID, Hand.Access>, sessionId: Session.ID) {
  const environments = yield* Layer.build(
    HandConnections.layer.pipe(Layer.provide(TestAccess.fixed(accesses)), Layer.provide(FetchHttpClient.layer)),
  ).pipe(Effect.map((context) => Context.get(context, HandConnections.Service)))
  return RenWorkspaceDriver.session(environments, sessionId)
})

const bound = Effect.gen(function* () {
  const sessionId = Session.ID.create()
  const access = yield* Sandbox.access({
    url: yield* Sandbox.url,
    environmentId,
    brain: Brain.ofSession(sessionId),
    directory: join(workspace, sessionId),
  })
  return { sessionId, driver: yield* sessionFor(new Map([[sessionId, access]]), sessionId) }
})

it.live("maps file operations and their errors to OpenCode's, under the session's folder", () =>
  Effect.gen(function* () {
    const subject = yield* bound
    const files = subject.driver.overrides
    const root = join(workspace, subject.sessionId)
    yield* files.mkdir(`${root}/tree/a`)
    yield* files.write(`${root}/tree/a/file.txt`, new TextEncoder().encode("hello world"))
    expect(yield* Effect.promise(() => Bun.file(join(workspace, subject.sessionId, "tree/a/file.txt")).text())).toBe(
      "hello world",
    )
    const read = yield* files.read(`${root}/tree/a/file.txt`, { offset: 6, length: 5 })
    expect(new TextDecoder().decode(read.bytes)).toBe("world")
    expect(read.info).toMatchObject({ type: "file", size: 11 })
    expect(yield* files.list(`${root}/tree/a`)).toEqual([{ name: "file.txt", type: "file" }])
    expect(yield* files.stat(`${root}/missing`).pipe(Effect.flip)).toBeInstanceOf(EnvironmentFiles.NotFound)
    const wrong = yield* files.read(`${root}/tree`).pipe(Effect.flip)
    expect(wrong instanceof EnvironmentFiles.WrongKind && wrong.actual).toBe("directory")
    yield* files.move(`${root}/tree/a/file.txt`, `${root}/tree/moved.txt`)
    expect((yield* files.stat(`${root}/tree/moved.txt`)).size).toBe(11)
    expect(yield* files.move(`${root}/tree/a/file.txt`, `${root}/again.txt`).pipe(Effect.flip)).toBeInstanceOf(
      EnvironmentFiles.NotFound,
    )
    expect(yield* files.write(`${root}/tree/moved.txt/child.txt`, new Uint8Array()).pipe(Effect.flip)).toBeInstanceOf(
      EnvironmentFiles.Failed,
    )
    yield* files.remove(`${root}/tree`)
    expect(yield* files.stat(`${root}/tree`).pipe(Effect.flip)).toBeInstanceOf(EnvironmentFiles.NotFound)
  }),
)

it.live("fails the exit code with KilledBySignal, as OpenCode's shell expects", () =>
  Effect.gen(function* () {
    const subject = yield* bound
    const handle = yield* subject.driver.spawner.spawn(ChildProcess.make("sleep", ["30"]))
    yield* handle.kill({ killSignal: "SIGTERM" })
    const error = yield* handle.exitCode.pipe(Effect.flip)
    expect(error.cause instanceof CrossSpawnSpawner.KilledBySignal && error.cause.signal).toBe("SIGTERM")
  }),
)

it.live("a file or shell call with no access, or on a sandbox that does not answer, gives the cause", () =>
  Effect.gen(function* () {
    const sessionId = Session.ID.create()
    const none = yield* sessionFor(new Map(), sessionId)
    const read = yield* none.overrides.read("/workspace/a.ts").pipe(Effect.flip)
    expect(read instanceof EnvironmentFiles.Failed && String(read.cause)).toContain("No access to a sandbox")
    const spawned = yield* none.spawner.spawn(ChildProcess.make("true", [])).pipe(Effect.flip)
    expect(spawned.message).toContain("No access to a sandbox")
    const dead = yield* sessionFor(
      new Map([
        [
          sessionId,
          yield* Sandbox.access({
            url: "http://127.0.0.1:9",
            environmentId,
            brain: Brain.ofSession(sessionId),
            directory: join(workspace, sessionId),
          }),
        ],
      ]),
      sessionId,
    )
    const unreachable = yield* dead.overrides.stat("/workspace/a.ts").pipe(Effect.flip)
    expect(unreachable instanceof EnvironmentFiles.Failed && String(unreachable.cause)).toContain("does not answer")
  }),
)

it.live(
  "refuses to read a file that is too large without a range, or to write one, before it reaches the sandbox, and names the limit",
  () =>
    Effect.gen(function* () {
      const subject = yield* bound
      const root = join(workspace, subject.sessionId)
      yield* subject.driver.overrides.mkdir(root)
      yield* Effect.promise(() =>
        writeFile(join(workspace, subject.sessionId, "large.bin"), "").then(() =>
          truncate(join(workspace, subject.sessionId, "large.bin"), maxFileBytes + 1),
        ),
      )
      const error = yield* subject.driver.overrides.read(`${root}/large.bin`).pipe(Effect.flip)
      expect(error instanceof EnvironmentFiles.Failed && String(error.cause)).toContain("use a range")
      const written = yield* subject.driver.overrides
        .write(`${root}/copy.bin`, new Uint8Array(maxFileBytes + 1))
        .pipe(Effect.flip)
      expect(written instanceof EnvironmentFiles.Failed && String(written.cause)).toContain("write it in parts")
      expect(yield* subject.driver.overrides.stat(`${root}/copy.bin`).pipe(Effect.flip)).toBeInstanceOf(
        EnvironmentFiles.NotFound,
      )
    }),
)
