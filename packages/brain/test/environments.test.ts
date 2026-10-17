import { expect } from "bun:test"
import type { Hello } from "@ren/brain-api/executor-api"
import { Executor } from "@ren/executor/executor"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { ExecutorClient } from "@ren/brain-api/executor-client"
import { Machine, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Queue,
  Ref,
  Schedule,
  Stream,
} from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { mkdtemp, realpath, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Environments } from "../src/environments.js"
import { EnvironmentAccess } from "../src/environment-access.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-")))
const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-elsewhere-")))
const it = testEffect(Machine.layer({ environmentId, workspace }))

const sessionId = Session.ID.create()
const brain = Brain.ofSession(sessionId)
const folder = (root = workspace) => join(root, sessionId)

const accessAt = (
  url: string,
  options: {
    readonly issuedAt?: number
    readonly lifetimeMs?: number
    readonly root?: string
    readonly generation?: number
  } = {},
) =>
  Machine.access({
    url,
    environmentId,
    brain,
    directory: folder(options.root),
    ...(options.issuedAt !== undefined && { issuedAt: options.issuedAt }),
    ...(options.lifetimeMs !== undefined && { lifetimeMs: options.lifetimeMs }),
    ...(options.generation !== undefined && { generation: options.generation }),
  })

const environmentsWith = (access: Layer.Layer<EnvironmentAccess.Service>) =>
  Layer.build(Environments.layer.pipe(Layer.provide(access), Layer.provide(FetchHttpClient.layer))).pipe(
    Effect.map((context) => Context.get(context, Environments.Service)),
  )

const opening = (open: EnvironmentAccess.Interface["open"]) =>
  Layer.succeed(
    EnvironmentAccess.Service,
    EnvironmentAccess.Service.of({ subscribe: Effect.succeed(Stream.never), open }),
  )

const machine = (options: Parameters<typeof Machine.layer>[0]) =>
  Layer.build(Layer.fresh(Machine.layer(options))).pipe(
    Effect.flatMap((context) => Effect.provide(Machine.url, context)),
  )

const eventually = <A, E, R>(attempt: Effect.Effect<A, E, R>, isDone: (value: A) => boolean) =>
  attempt.pipe(Effect.repeat({ until: isDone, schedule: Schedule.spaced(10) }), Effect.timeout(5_000))

const renDown = (id: Session.ID) => new EnvironmentAccess.Unavailable({ sessionId: id, message: "connection refused" })

const noAccess = (id: Session.ID) => new EnvironmentAccess.NotFound({ sessionId: id, message: "no binding" })

const connect = (environments: Environments.Interface) => environments.connect(sessionId, "files")

const build = (options: { readonly failures: number; readonly gate?: Deferred.Deferred<void> }) =>
  Effect.gen(function* () {
    const access = yield* accessAt(yield* Machine.url)
    const opens = yield* Ref.make(0)
    const requests = yield* Ref.make(0)
    const http = Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        HttpClient.mapRequestEffect(client, (request) =>
          Ref.update(requests, (count) => count + 1).pipe(Effect.as(request)),
        ),
      ),
    ).pipe(Layer.provide(FetchHttpClient.layer))
    const host = opening(() =>
      Effect.gen(function* () {
        if (options.gate) yield* Deferred.await(options.gate)
        const count = yield* Ref.getAndUpdate(opens, (value) => value + 1)
        return count < options.failures ? { ...access, token: "invalid" } : access
      }),
    )
    const environments = yield* Layer.build(Environments.layer.pipe(Layer.provide(host), Layer.provide(http))).pipe(
      Effect.map((context) => Context.get(context, Environments.Service)),
    )
    return { environments, opens, requests }
  })

it.live("concurrent failing connects share one failure and one renewal", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>()
    const subject = yield* build({ failures: 2, gate })
    const [exits] = yield* Effect.all(
      [
        Effect.all(
          Array.from({ length: 10 }, () => Effect.exit(connect(subject.environments))),
          { concurrency: "unbounded" },
        ),
        Deferred.succeed(gate, undefined),
      ],
      { concurrency: "unbounded" },
    )
    const errors = exits.map((exit) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined))
    expect(errors[0]).toBeInstanceOf(Environments.Unavailable)
    expect(new Set(errors).size).toBe(1)
    expect(yield* Ref.get(subject.opens)).toBe(2)
    expect(yield* Ref.get(subject.requests)).toBe(2)
  }),
)

it.live(
  "a failed lookup is not cached, the next connect retries, and the first contact makes the session's folder",
  () =>
    Effect.gen(function* () {
      const subject = yield* build({ failures: 4 })
      expect((yield* Effect.flip(connect(subject.environments))).reason).toBe("token_refused")
      expect((yield* Effect.flip(connect(subject.environments))).reason).toBe("token_refused")
      const connection = yield* connect(subject.environments)
      expect([connection.hello.environmentId, connection.directory]).toEqual([environmentId, folder()])
      expect((yield* Effect.promise(() => stat(folder()))).isDirectory()).toBe(true)
      expect(yield* Ref.get(subject.opens)).toBe(5)
      expect(yield* connect(subject.environments)).toBe(connection)
      expect(yield* Ref.get(subject.opens)).toBe(5)
    }),
)

it.live("a session without access fails with no access", () =>
  Effect.gen(function* () {
    const environments = yield* environmentsWith(EnvironmentAccess.layerFixed(new Map()))
    const error = yield* connect(environments).pipe(Effect.flip)
    expect([error.reason, error.message]).toEqual([
      "no_access",
      `No access to a sandbox: Session ${sessionId} has no access to an environment`,
    ])
  }),
)

it.live("refuses an executor that serves another environment than the access names", () =>
  Effect.gen(function* () {
    const access = yield* accessAt(yield* Machine.url)
    const environments = yield* environmentsWith(
      EnvironmentAccess.layerFixed(new Map([[sessionId, { ...access, environmentId: Environment.ID.create() }]])),
    )
    expect((yield* connect(environments).pipe(Effect.flip)).reason).toBe("incompatible")
  }),
)

it.live("a session folder that is a file on the sandbox fails the first contact with its cause", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-folder-file-"))))
    yield* Effect.promise(() => writeFile(join(root, sessionId), "not a folder"))
    const url = yield* machine({ environmentId, workspace: root })
    const environments = yield* environmentsWith(
      EnvironmentAccess.layerFixed(new Map([[sessionId, yield* accessAt(url, { root })]])),
    )
    const error = yield* connect(environments).pipe(Effect.flip)
    expect(error.reason).toBe("unusable")
    expect(error.message).toContain(`Could not make the folder ${join(root, sessionId)} on the sandbox`)
  }),
)

it.effect("refreshes a token in its last five minutes, once for many concurrent calls, and keeps the connection", () =>
  Effect.gen(function* () {
    const url = yield* Machine.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 900_000 })),
        ),
      ),
    )
    const connection = yield* connect(environments)
    yield* TestClock.adjust(Duration.seconds(9 * 60 + 59))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(1)
    yield* TestClock.adjust(Duration.seconds(2))
    yield* Effect.all(
      Array.from({ length: 10 }, () => connection.client["executor.hello"]()),
      { concurrency: "unbounded" },
    )
    expect(yield* Ref.get(opens)).toBe(2)
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
    expect(yield* connect(environments)).toBe(connection)
  }),
)

it.effect("a 20-second token refreshes in its last third, not on every call", () =>
  Effect.gen(function* () {
    const url = yield* Machine.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening(() =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 20_000 })),
        ),
      ),
    )
    const connection = yield* connect(environments)
    yield* Effect.forEach([1, 2, 3], () => connection.client["executor.hello"](), { discard: true })
    expect(yield* Ref.get(opens)).toBe(1)
    yield* TestClock.adjust(Duration.seconds(14))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.effect("keeps using a token it could not refresh while Ren does not answer, and asks Ren once in 30 seconds", () =>
  Effect.gen(function* () {
    const url = yield* Machine.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      opening((id) =>
        Ref.getAndUpdate(opens, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 0
              ? Clock.currentTimeMillis.pipe(
                  Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 600_000 })),
                )
              : Effect.fail(renDown(id)),
          ),
        ),
      ),
    )
    const connection = yield* connect(environments)
    yield* TestClock.adjust(Duration.minutes(7))
    yield* Effect.forEach(Array.from({ length: 100 }), () => connection.client["executor.hello"](), { discard: true })
    expect(yield* Ref.get(opens)).toBe(2)
    yield* TestClock.adjust(Duration.seconds(29))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
    yield* TestClock.adjust(Duration.seconds(2))
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(3)
    expect(yield* connect(environments)).toBe(connection)
  }),
)

it.effect(
  "fails clearly once a token expires while Ren is down, and works again on the first try after the backoff",
  () =>
    Effect.gen(function* () {
      const url = yield* Machine.url
      const isDown = yield* Ref.make(false)
      const environments = yield* environmentsWith(
        opening((id) =>
          Effect.gen(function* () {
            if (yield* Ref.get(isDown)) return yield* renDown(id)
            return yield* accessAt(url, { issuedAt: yield* Clock.currentTimeMillis, lifetimeMs: 600_000 })
          }),
        ),
      )
      yield* connect(environments)
      yield* Ref.set(isDown, true)
      yield* TestClock.adjust(Duration.minutes(11))
      const error = yield* connect(environments).pipe(Effect.flip)
      expect([error.reason, error.message]).toEqual(["ren_unavailable", "Ren does not answer: connection refused"])
      yield* Ref.set(isDown, false)
      expect((yield* connect(environments).pipe(Effect.flip)).reason).toBe("ren_unavailable")
      yield* TestClock.adjust(Duration.seconds(31))
      expect((yield* connect(environments)).hello.environmentId).toBe(environmentId)
    }),
)

it.effect(
  "a refresh that Ren answers with no access closes the connection at once, and the next call has no access",
  () =>
    Effect.gen(function* () {
      const url = yield* Machine.url
      const opens = yield* Ref.make(0)
      const environments = yield* environmentsWith(
        opening((id) =>
          Ref.getAndUpdate(opens, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 0
                ? Clock.currentTimeMillis.pipe(
                    Effect.flatMap((issuedAt) => accessAt(url, { issuedAt, lifetimeMs: 600_000 })),
                  )
                : Effect.fail(noAccess(id)),
            ),
          ),
        ),
      )
      const connection = yield* connect(environments)
      yield* TestClock.adjust(Duration.minutes(7))
      yield* connection.client["executor.hello"]()
      const error = yield* connect(environments).pipe(Effect.flip)
      expect([error.reason, error.message]).toEqual(["no_access", "No access to a sandbox: no binding"])
    }),
)

it.live(
  "a sandbox that does not answer fails the call once, and the next call asks Ren and reaches the new sandbox",
  () =>
    Effect.gen(function* () {
      const relay = yield* Relay.make(Relay.portOf(yield* Machine.url))
      const second = yield* machine({ environmentId, workspace: elsewhere })
      const current = yield* Ref.make(yield* accessAt(relay.url))
      const opens = yield* Ref.make(0)
      const environments = yield* environmentsWith(
        opening(() => Ref.update(opens, (count) => count + 1).pipe(Effect.andThen(Ref.get(current)))),
      )
      const connection = yield* connect(environments)
      yield* relay.refuse(true)
      yield* relay.cut
      yield* Ref.set(current, yield* accessAt(second, { root: elsewhere, generation: 2 }))
      const failed = yield* connection.client["process.spawn"]({ command: "true", arguments: [] }).pipe(Effect.flip)
      expect(ExecutorClient.isNoAnswer(failed)).toBe(true)
      expect(yield* Ref.get(opens)).toBe(1)
      const next = yield* connect(environments)
      expect([next.directory, yield* Ref.get(opens)]).toEqual([folder(elsewhere), 2])
    }),
)

const statArrived = Effect.runSync(Deferred.make<void>())

const frozen = Layer.effect(
  Executor.Service,
  Effect.map(Executor.Service, (executor) =>
    Executor.Service.of({
      ...executor,
      stat: () => Deferred.succeed(statArrived, undefined).pipe(Effect.andThen(Effect.never)),
    }),
  ),
).pipe(Layer.provide(NodeCompatible.layer))

it.effect("a call to a sandbox that accepts the request and never answers ends in its time limit", () =>
  Effect.gen(function* () {
    const url = yield* machine({ environmentId, workspace, executor: frozen })
    const opens = yield* Ref.make(0)
    const access = yield* accessAt(url, { lifetimeMs: 3_600_000 })
    const environments = yield* environmentsWith(
      opening(() => Ref.update(opens, (count) => count + 1).pipe(Effect.as(access))),
    )
    const connection = yield* connect(environments)
    const call = yield* connection.client["files.stat"]({ path: folder() }).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(statArrived)
    yield* TestClock.adjust(ExecutorClient.answerWithin["files.stat"])
    const error = yield* Fiber.join(call)
    expect(error.message).toContain("The sandbox did not answer files.stat within 30s")
    yield* connect(environments)
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.live("keeps a connection when only its token changes", () =>
  Effect.gen(function* () {
    const url = yield* Machine.url
    const first = yield* accessAt(url)
    const context = yield* Layer.build(EnvironmentAccess.layerMemory(new Map([[sessionId, first]])))
    const memory = Context.get(context, EnvironmentAccess.Memory)
    const environments = yield* environmentsWith(Layer.succeedContext(context))
    const kept = yield* Effect.scoped(connect(environments))
    yield* memory.set(sessionId, yield* accessAt(url, { lifetimeMs: 900_000 }))
    expect(yield* Effect.scoped(connect(environments))).toBe(kept)
  }),
)

it.live(
  "connects again when a change notice names a replaced sandbox, and the old connection still serves its holders",
  () =>
    Effect.gen(function* () {
      const access = yield* accessAt(yield* Machine.url)
      const context = yield* Layer.build(EnvironmentAccess.layerMemory(new Map([[sessionId, access]])))
      const environments = yield* environmentsWith(Layer.succeedContext(context))
      const connection = yield* connect(environments)
      yield* Context.get(context, EnvironmentAccess.Memory).set(sessionId, { ...access, generation: 2 })
      const replaced = yield* eventually(connect(environments), (next) => next !== connection)
      expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
      expect((yield* replaced.client["executor.hello"]()).environmentId).toBe(environmentId)
    }),
)

const controlled = Effect.fnUntraced(function* (initial: Environment.Access) {
  const current = yield* Ref.make(initial)
  const changes = yield* Queue.unbounded<Deferred.Deferred<void>>()
  const applied = yield* Ref.make(Option.none<Deferred.Deferred<void>>())
  const gate = yield* Ref.make(
    Option.none<{ readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }>(),
  )
  const environments = yield* environmentsWith(
    Layer.succeed(
      EnvironmentAccess.Service,
      EnvironmentAccess.Service.of({
        open: () =>
          Effect.gen(function* () {
            const snapshot = yield* Ref.get(current)
            const held = yield* Ref.getAndSet(gate, Option.none())
            if (Option.isSome(held)) {
              yield* Deferred.succeed(held.value.entered, undefined)
              yield* Deferred.await(held.value.release)
            }
            return snapshot
          }),
        subscribe: Effect.succeed(
          Stream.fromEffectRepeat(
            Effect.gen(function* () {
              const previous = yield* Ref.get(applied)
              if (Option.isSome(previous)) yield* Deferred.succeed(previous.value, undefined)
              yield* Ref.set(applied, Option.some(yield* Queue.take(changes)))
              return sessionId
            }),
          ),
        ),
      }),
    ),
  )
  return {
    current,
    environments,
    notifyAndWait: Effect.gen(function* () {
      const done = yield* Deferred.make<void>()
      yield* Queue.offer(changes, done)
      yield* Deferred.await(done)
    }),
    holdNextOpen: Effect.gen(function* () {
      const held = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
      yield* Ref.set(gate, Option.some(held))
      return held
    }),
  }
})

const where = (environments: Environments.Interface) =>
  Effect.scoped(Effect.flatMap(connect(environments), (connection) => connection.client["executor.hello"]())).pipe(
    Effect.map((hello) => hello.workspaceDirectory),
  )

it.effect("moves to the new sandbox when a renewed access names a new address, with no change notice", () =>
  Effect.gen(function* () {
    const second = yield* machine({ environmentId, workspace: elsewhere })
    const subject = yield* controlled(yield* accessAt(yield* Machine.url, { issuedAt: yield* Clock.currentTimeMillis }))
    expect(yield* where(subject.environments)).toBe(workspace)
    yield* TestClock.adjust(Duration.minutes(7))
    yield* Ref.set(
      subject.current,
      yield* accessAt(second, { root: elsewhere, issuedAt: yield* Clock.currentTimeMillis }),
    )
    yield* where(subject.environments)
    expect(yield* where(subject.environments)).toBe(elsewhere)
  }),
)

it.live("a change notice during the first connect leaves the next call on the new sandbox", () =>
  Effect.gen(function* () {
    const second = yield* machine({ environmentId, workspace: elsewhere })
    const subject = yield* controlled(yield* accessAt(yield* Machine.url))
    const gate = yield* subject.holdNextOpen
    const first = yield* Effect.forkScoped(where(subject.environments))
    yield* Deferred.await(gate.entered)
    yield* Ref.set(subject.current, yield* accessAt(second, { root: elsewhere }))
    yield* subject.notifyAndWait
    yield* Deferred.succeed(gate.release, undefined)
    expect(yield* Fiber.join(first)).toBe(workspace)
    expect(yield* where(subject.environments)).toBe(elsewhere)
  }),
)

const reporting = (hello: Partial<Pick<Hello, "protocol" | "capabilities">>) =>
  Layer.effect(
    Executor.Service,
    Effect.map(Executor.Service, (executor) =>
      Executor.Service.of({
        ...executor,
        hello: {
          protocol: hello.protocol ?? executor.hello.protocol,
          capabilities: hello.capabilities ?? executor.hello.capabilities,
          version: executor.hello.version,
          environmentId: executor.hello.environmentId,
          workspaceDirectory: executor.hello.workspaceDirectory,
          os: executor.hello.os,
          arch: executor.hello.arch,
        },
      }),
    ),
  ).pipe(Layer.provide(NodeCompatible.layer))

it.live(
  "refuses an executor that speaks another protocol, and gives each tool family only the capability it needs",
  () =>
    Effect.gen(function* () {
      const environmentsFor = Effect.fnUntraced(function* (hello: Partial<Pick<Hello, "protocol" | "capabilities">>) {
        const url = yield* machine({ environmentId, workspace, executor: reporting(hello) })
        return yield* environmentsWith(EnvironmentAccess.layerFixed(new Map([[sessionId, yield* accessAt(url)]])))
      })
      const newer = yield* Effect.scoped(connect(yield* environmentsFor({ protocol: 2 }))).pipe(Effect.flip)
      expect([newer.reason, newer.message]).toEqual([
        "incompatible",
        "The executor is not compatible: it speaks protocol 2, not 1",
      ])
      const filesOnly = yield* environmentsFor({ capabilities: ["files"] })
      expect((yield* Effect.scoped(filesOnly.connect(sessionId, "files"))).hello.capabilities).toEqual(["files"])
      const shell = yield* Effect.scoped(filesOnly.connect(sessionId, "processes")).pipe(Effect.flip)
      expect([shell.reason, shell.message]).toEqual([
        "incompatible",
        "The executor is not compatible: the sandbox does not support shell commands",
      ])
    }),
)

it.live("gets a new access once when the executor refuses one the brain still thinks is valid, and does not loop", () =>
  Effect.gen(function* () {
    const url = yield* Machine.url
    const opens = yield* Ref.make(0)
    const refusedToken = (yield* Machine.access({
      url,
      environmentId: Environment.ID.create(),
      brain,
      directory: folder(),
    })).token
    const environments = yield* environmentsWith(
      opening(() =>
        Effect.gen(function* () {
          const access = yield* accessAt(url)
          const count = yield* Ref.getAndUpdate(opens, (value) => value + 1)
          return count === 1 ? access : { ...access, token: refusedToken }
        }),
      ),
    )
    const connection = yield* Effect.scoped(connect(environments))
    expect(connection.hello.environmentId).toBe(environmentId)
    expect(yield* Ref.get(opens)).toBe(2)
    const always = yield* Ref.make(0)
    const refusing = yield* environmentsWith(
      opening(() =>
        Ref.update(always, (count) => count + 1).pipe(
          Effect.andThen(accessAt(url)),
          Effect.map((access) => ({ ...access, token: refusedToken })),
        ),
      ),
    )
    const refused = yield* Effect.scoped(connect(refusing)).pipe(Effect.flip)
    expect([refused.reason, yield* Ref.get(always)]).toEqual(["token_refused", 2])
  }),
)
