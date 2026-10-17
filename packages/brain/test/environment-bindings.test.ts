import { expect, test } from "bun:test"
import { Machine, Processes, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Exit, Layer, Option, Schedule, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { KeyValueStore } from "effect/persistence"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EnvironmentAccess } from "../src/environment-access.js"
import { EnvironmentBindings } from "../src/environment-bindings.js"
import { Environments } from "../src/environments.js"
import { OpenCodeWorkspaceDriver } from "../src/opencode-workspace-driver.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-bindings-")))
await mkdir(join(workspace, "project"))
await Bun.write(join(workspace, "project/notes.md"), "on the environment\n")
const it = testEffect(Machine.layer({ environmentId, workspace }))

const build = Effect.fnUntraced(function* (store: Layer.Layer<KeyValueStore.KeyValueStore>) {
  const access = yield* Machine.access({ url: yield* Machine.url, environmentId, brain: Brain.ID.create() })
  const context = yield* Layer.build(
    EnvironmentBindings.layer.pipe(
      Layer.provideMerge(Environments.layer),
      Layer.provide(EnvironmentAccess.layerFixed([access])),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(store),
    ),
  )
  return {
    environments: Context.get(context, Environments.Service),
    bindings: Context.get(context, EnvironmentBindings.Service),
  }
})

const project = join(workspace, "project")

it.live("stores a binding and reads it back from the store in a new layer", () =>
  Effect.gen(function* () {
    const store = Layer.succeedContext(yield* Layer.build(KeyValueStore.layerMemory))
    const sessionId = Session.ID.create()
    const binding = { sessionDirectory: "/workspace", location: { environmentId, directory: project } }
    yield* (yield* build(store)).bindings.set(sessionId, binding)
    expect(yield* (yield* build(store)).bindings.get(sessionId)).toEqual(Option.some(binding))
    expect(yield* (yield* build(store)).bindings.get(Session.ID.create())).toEqual(Option.none())
  }),
)

it.live("refuses a directory the environment lacks, or a file, and keeps the old binding", () =>
  Effect.gen(function* () {
    const subject = yield* build(KeyValueStore.layerMemory)
    const sessionId = Session.ID.create()
    const binding = { sessionDirectory: "/workspace", location: { environmentId, directory: project } }
    yield* subject.bindings.set(sessionId, binding)
    const missing = yield* Effect.flip(
      subject.bindings.set(sessionId, { ...binding, location: { environmentId, directory: join(workspace, "gone") } }),
    )
    expect(missing.message).toContain("does not exist")
    const file = yield* Effect.flip(
      subject.bindings.set(sessionId, {
        ...binding,
        location: { environmentId, directory: join(project, "notes.md") },
      }),
    )
    expect(file.message).toContain("is not a directory")
    const unknown = yield* Effect.flip(
      subject.bindings.set(sessionId, {
        ...binding,
        location: { environmentId: Environment.ID.create(), directory: project },
      }),
    )
    expect(unknown._tag).toBe("EnvironmentBindings.Unusable")
    expect(yield* subject.bindings.get(sessionId)).toEqual(Option.some(binding))
  }),
)

it.live("follows the session's binding on every file call, under the session's directory", () =>
  Effect.gen(function* () {
    const subject = yield* build(KeyValueStore.layerMemory)
    const sessionId = Session.ID.create()
    const connection = OpenCodeWorkspaceDriver.sessionConnection(subject.environments, subject.bindings, sessionId)
    const unbound = yield* Effect.flip(connection.overrides.read("/workspace/notes.md"))
    expect(unbound._tag).toBe("Environment.Failed")
    yield* subject.bindings.set(sessionId, {
      sessionDirectory: "/workspace",
      location: { environmentId, directory: project },
    })
    const read = yield* connection.overrides.read("/workspace/notes.md")
    expect(new TextDecoder().decode(read.bytes)).toBe("on the environment\n")
    const missing = yield* Effect.flip(connection.overrides.read("/workspace/absent.md"))
    expect(missing._tag === "Environment.NotFound" && missing.path).toBe("/workspace/absent.md")
    yield* subject.bindings.set(sessionId, { sessionDirectory: "/workspace", location: null })
    expect((yield* Effect.flip(connection.overrides.read("/workspace/notes.md")))._tag).toBe("Environment.Failed")
  }),
)

it.live("a file override follows a changed binding without changing another session's binding", () =>
  Effect.gen(function* () {
    const subject = yield* build(KeyValueStore.layerMemory)
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(workspace, "moving-"))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    )
    const first = join(directory, "first")
    const second = join(directory, "second")
    yield* Effect.promise(() => Promise.all([mkdir(first), mkdir(second)]))
    const sessionId = Session.ID.create()
    const otherId = Session.ID.create()
    yield* Effect.forEach([sessionId, otherId], (id) =>
      subject.bindings.set(id, { sessionDirectory: "/workspace", location: { environmentId, directory: first } }),
    )
    yield* subject.bindings.set(sessionId, {
      sessionDirectory: "/workspace",
      location: { environmentId, directory: second },
    })
    const connection = OpenCodeWorkspaceDriver.sessionConnection(subject.environments, subject.bindings, sessionId)
    const other = OpenCodeWorkspaceDriver.sessionConnection(subject.environments, subject.bindings, otherId)
    yield* connection.overrides.write("/workspace/marker", new TextEncoder().encode("second"))
    yield* other.overrides.write("/workspace/marker", new TextEncoder().encode("first"))
    expect(yield* Effect.promise(() => Bun.file(join(second, "marker")).text())).toBe("second")
    expect(yield* Effect.promise(() => Bun.file(join(first, "marker")).text())).toBe("first")
  }),
)

test.each([
  { from: "/workspace", to: "/home/ren/project", path: "/workspace", expected: "/home/ren/project" },
  { from: "/workspace", to: "/home/ren/project", path: "/workspace/src/a.ts", expected: "/home/ren/project/src/a.ts" },
  { from: "/workspace", to: "/home/ren/project", path: "/workspaces/other", expected: "/workspaces/other" },
  { from: "/workspace", to: "/home/ren/project", path: "/tmp/out", expected: "/tmp/out" },
  { from: "/workspace", to: "/home/ren/project", path: "relative/a.ts", expected: "relative/a.ts" },
  { from: "/workspace/", to: "/home/ren/project", path: "/workspace", expected: "/home/ren/project" },
  { from: "/workspace/", to: "/home/ren/project", path: "/workspace/src/a.ts", expected: "/home/ren/project/src/a.ts" },
  { from: "/workspace", to: "/home/ren/project/", path: "/workspace", expected: "/home/ren/project" },
  { from: "/workspace", to: "/home/ren/project/", path: "/workspace/a.ts", expected: "/home/ren/project/a.ts" },
  { from: "/", to: "/home/ren/project", path: "/", expected: "/home/ren/project" },
  { from: "/", to: "/home/ren/project", path: "/a.ts", expected: "/home/ren/project/a.ts" },
  { from: "/workspace", to: "/", path: "/workspace", expected: "/" },
  { from: "/workspace", to: "/", path: "/workspace/a.ts", expected: "/a.ts" },
])("maps $path from $from onto $to", (row) => {
  expect(OpenCodeWorkspaceDriver.physicalPath(row.from, row.to)(row.path)).toBe(row.expected)
})

const replaceable = Effect.gen(function* () {
  const access = yield* Machine.access({ url: yield* Machine.url, environmentId, brain: Brain.ID.create() })
  const context = yield* Layer.build(
    EnvironmentBindings.layer.pipe(
      Layer.provideMerge(Environments.layer),
      Layer.provideMerge(EnvironmentAccess.layerMemory([access])),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(KeyValueStore.layerMemory),
    ),
  )
  const sessionId = Session.ID.create()
  const environments = Context.get(context, Environments.Service)
  const bindings = Context.get(context, EnvironmentBindings.Service)
  yield* bindings.set(sessionId, { sessionDirectory: "/workspace", location: { environmentId, directory: project } })
  const original = yield* Effect.scoped(environments.connect(environmentId))
  const replacement = yield* Scope.make()
  const next = yield* Layer.buildWithScope(Layer.fresh(Machine.layer({ environmentId, workspace })), replacement).pipe(
    Effect.flatMap((built) => Effect.provide(Machine.url, built)),
  )
  return {
    connection: OpenCodeWorkspaceDriver.sessionConnection(environments, bindings, sessionId),
    replace: Context.get(context, EnvironmentAccess.Memory)
      .set({ ...access, url: next, generation: 2 })
      .pipe(
        Effect.andThen(
          Effect.scoped(environments.connect(environmentId)).pipe(
            Effect.repeat({ until: (current) => current !== original, schedule: Schedule.spaced(10) }),
            Effect.timeout(5_000),
          ),
        ),
      ),
    stopReplacement: Scope.close(replacement, Exit.void),
  }
})

const text = (stream: Stream.Stream<Uint8Array, unknown>) => Stream.decodeText(stream).pipe(Stream.mkString)

it.live(
  "a command started before a replacement finishes there and returns its result, and the next goes to the new machine",
  () =>
    Effect.gen(function* () {
      const subject = yield* replaceable
      const old = yield* subject.connection.spawner.spawn(
        ChildProcess.make("sh", ["-c", "sleep 0.5; echo old; exit 6"]),
      )
      yield* subject.replace
      const next = yield* subject.connection.spawner.spawn(ChildProcess.make("sh", ["-c", "echo new"]))
      expect(yield* text(next.stdout)).toBe("new\n")
      expect(yield* text(old.stdout)).toBe("old\n")
      expect(Number(yield* old.exitCode)).toBe(6)
      yield* subject.stopReplacement
      const after = yield* subject.connection.spawner.spawn(ChildProcess.make("true", [])).pipe(Effect.flip)
      expect(after.reason._tag).toBe("Unknown")
    }),
)

it.live("stopping a command after a replacement still kills it on the old machine", () =>
  Effect.gen(function* () {
    const subject = yield* replaceable
    const scope = yield* Scope.make()
    const old = yield* subject.connection.spawner.spawn(ChildProcess.make("sleep", ["30"])).pipe(Scope.provide(scope))
    yield* subject.replace
    yield* Scope.close(scope, Exit.void)
    expect(yield* Processes.exits(old.pid)).toBe(true)
  }),
)
