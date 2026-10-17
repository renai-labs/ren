import { expect } from "bun:test"
import type { Hello } from "@ren/brain-api/executor-api"
import { Executor } from "@ren/executor/executor"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Machine, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
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
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Environments } from "../src/environments.js"
import { EnvironmentAccess } from "../src/environment-access.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-")))
const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-elsewhere-")))
const it = testEffect(Machine.layer({ environmentId, workspace }))

const environmentsWith = (access: Layer.Layer<EnvironmentAccess.Service>) =>
  Layer.build(Environments.layer.pipe(Layer.provide(access), Layer.provide(FetchHttpClient.layer))).pipe(
    Effect.map((context) => Context.get(context, Environments.Service)),
  )

const machine = (options: Parameters<typeof Machine.layer>[0]) =>
  Layer.build(Layer.fresh(Machine.layer(options))).pipe(
    Effect.flatMap((context) => Effect.provide(Machine.url, context)),
  )

const eventually = <A, E, R>(attempt: Effect.Effect<A, E, R>, isDone: (value: A) => boolean) =>
  attempt.pipe(Effect.repeat({ until: isDone, schedule: Schedule.spaced(10) }), Effect.timeout(5_000))

const build = (options: { readonly failures: number; readonly gate?: Deferred.Deferred<void> }) =>
  Effect.gen(function* () {
    const access = yield* Machine.access({ url: yield* Machine.url, environmentId, brain: Brain.ID.create() })
    const opens = yield* Ref.make(0)
    const requests = yield* Ref.make(0)
    const host = Layer.succeed(
      EnvironmentAccess.Service,
      EnvironmentAccess.Service.of({
        subscribe: Effect.succeed(Stream.never),
        open: () =>
          Effect.gen(function* () {
            if (options.gate) yield* Deferred.await(options.gate)
            const count = yield* Ref.getAndUpdate(opens, (value) => value + 1)
            return count < options.failures ? { ...access, token: "invalid" } : access
          }),
      }),
    )
    const http = Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        HttpClient.mapRequestEffect(client, (request) =>
          Ref.update(requests, (count) => count + 1).pipe(Effect.as(request)),
        ),
      ),
    ).pipe(Layer.provide(FetchHttpClient.layer))
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
          Array.from({ length: 10 }, () => Effect.exit(subject.environments.connect(environmentId))),
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

it.live("a failed lookup is not cached and the next connect retries", () =>
  Effect.gen(function* () {
    const subject = yield* build({ failures: 4 })
    const first = yield* Effect.flip(subject.environments.connect(environmentId))
    expect(first.reason).toBe("unreachable")
    const second = yield* Effect.flip(subject.environments.connect(environmentId))
    expect(second.reason).toBe("unreachable")
    const connection = yield* subject.environments.connect(environmentId)
    expect(connection.hello.environmentId).toBe(environmentId)
    expect(yield* Ref.get(subject.opens)).toBe(5)
    expect(yield* Ref.get(subject.requests)).toBe(5)
    expect(yield* subject.environments.connect(environmentId)).toBe(connection)
    expect(yield* Ref.get(subject.opens)).toBe(5)
  }),
)

it.live("an environment the brain has no access to is not found", () =>
  Effect.gen(function* () {
    const environments = yield* environmentsWith(EnvironmentAccess.layerFixed([]))
    expect((yield* environments.connect(environmentId).pipe(Effect.flip)).reason).toBe("not_found")
  }),
)

it.todo("REN-1486 refuses an authenticated executor whose identity differs from the requested environment", () =>
  Effect.gen(function* () {
    const requested = Environment.ID.create()
    const access = yield* Machine.access({ url: yield* Machine.url, environmentId, brain: Brain.ID.create() })
    const environments = yield* environmentsWith(
      EnvironmentAccess.layerFixed([{ ...access, environmentId: requested }]),
    )
    const exit = yield* Effect.exit(environments.connect(requested))
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "Environments.Unavailable",
      environmentId: requested,
      reason: "incompatible",
    })
  }),
)

it.effect("refreshes a token in its last five minutes, once for many concurrent calls, and keeps the connection", () =>
  Effect.gen(function* () {
    const url = yield* Machine.url
    const brain = Brain.ID.create()
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: (id) =>
            Ref.update(opens, (count) => count + 1).pipe(
              Effect.andThen(Clock.currentTimeMillis),
              Effect.flatMap((issuedAt) => Machine.access({ url, environmentId: id, brain, issuedAt })),
            ),
        }),
      ),
    )
    const connection = yield* environments.connect(environmentId)
    expect(yield* Ref.get(opens)).toBe(1)
    yield* TestClock.adjust(Duration.minutes(6))
    yield* Effect.all(
      Array.from({ length: 10 }, () => connection.client["executor.hello"]()),
      { concurrency: "unbounded" },
    )
    expect(yield* Ref.get(opens)).toBe(2)
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
    expect(yield* environments.connect(environmentId)).toBe(connection)
  }),
)

it.live("keeps using a token it could not refresh until the token expires", () =>
  Effect.gen(function* () {
    const url = yield* Machine.url
    const brain = Brain.ID.create()
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: (id) =>
            Ref.getAndUpdate(opens, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                count === 0
                  ? Machine.access({ url, environmentId: id, brain, lifetimeMs: 60_000 })
                  : Effect.fail(new EnvironmentAccess.NotFound({ environmentId: id })),
              ),
            ),
        }),
      ),
    )
    const connection = yield* environments.connect(environmentId)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
    expect(yield* Ref.get(opens)).toBe(3)
  }),
)

it.live("keeps a connection when only its token changes, or when another environment's machine is replaced", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const secondId = Environment.ID.create()
    const url = yield* Machine.url
    const firstAccess = yield* Machine.access({ url, environmentId, brain })
    const secondAccess = yield* Machine.access({
      url: yield* machine({ environmentId: secondId, workspace }),
      environmentId: secondId,
      brain,
    })
    const context = yield* Layer.build(EnvironmentAccess.layerMemory([firstAccess, secondAccess]))
    const memory = Context.get(context, EnvironmentAccess.Memory)
    const environments = yield* environmentsWith(Layer.succeedContext(context))
    const kept = yield* Effect.scoped(environments.connect(environmentId))
    const moved = yield* Effect.scoped(environments.connect(secondId))
    yield* memory.set(yield* Machine.access({ url, environmentId, brain, lifetimeMs: 900_000 }))
    yield* memory.set({ ...secondAccess, generation: 2 })
    yield* eventually(Effect.scoped(environments.connect(secondId)), (next) => next !== moved)
    expect(yield* Effect.scoped(environments.connect(environmentId))).toBe(kept)
  }),
)

it.live(
  "connects again when the environment's machine is replaced, and the old connection still serves its holders",
  () =>
    Effect.gen(function* () {
      const access = yield* Machine.access({ url: yield* Machine.url, environmentId, brain: Brain.ID.create() })
      const context = yield* Layer.build(EnvironmentAccess.layerMemory([access]))
      const environments = yield* environmentsWith(Layer.succeedContext(context))
      const connection = yield* environments.connect(environmentId)
      yield* Context.get(context, EnvironmentAccess.Memory).set({ ...access, generation: 2 })
      const replaced = yield* eventually(environments.connect(environmentId), (next) => next !== connection)
      expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
      expect((yield* replaced.client["executor.hello"]()).environmentId).toBe(environmentId)
    }),
)

it.live("stops connecting to an environment once its access is removed", () =>
  Effect.gen(function* () {
    const access = yield* Machine.access({ url: yield* Machine.url, environmentId, brain: Brain.ID.create() })
    const context = yield* Layer.build(EnvironmentAccess.layerMemory([access]))
    const environments = yield* environmentsWith(Layer.succeedContext(context))
    yield* environments.connect(environmentId)
    yield* Context.get(context, EnvironmentAccess.Memory).remove(environmentId)
    const exit = yield* eventually(Effect.exit(environments.connect(environmentId)), Exit.isFailure)
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ reason: "not_found" })
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
              return initial.environmentId
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
  Effect.scoped(
    Effect.flatMap(environments.connect(environmentId), (connection) => connection.client["executor.hello"]()),
  ).pipe(Effect.map((hello) => hello.workspaceDirectory))

it.effect("moves to the new machine when a renewed pass names a new address, with no change message", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const second = yield* machine({ environmentId, workspace: elsewhere })
    const subject = yield* controlled(
      yield* Machine.access({
        url: yield* Machine.url,
        environmentId,
        brain,
        issuedAt: yield* Clock.currentTimeMillis,
      }),
    )
    expect(yield* where(subject.environments)).toBe(workspace)
    yield* TestClock.adjust(Duration.minutes(6))
    yield* Ref.set(
      subject.current,
      yield* Machine.access({ url: second, environmentId, brain, issuedAt: yield* Clock.currentTimeMillis }),
    )
    yield* where(subject.environments)
    expect(yield* where(subject.environments)).toBe(elsewhere)
  }),
)

it.live("a change during the first connect leaves the next call on the new machine", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const second = yield* machine({ environmentId, workspace: elsewhere })
    const subject = yield* controlled(yield* Machine.access({ url: yield* Machine.url, environmentId, brain }))
    const gate = yield* subject.holdNextOpen
    const first = yield* Effect.forkScoped(where(subject.environments))
    yield* Deferred.await(gate.entered)
    yield* Ref.set(subject.current, yield* Machine.access({ url: second, environmentId, brain }))
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

it.live("refuses an executor that speaks another protocol or lacks a capability", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const refusal = Effect.fnUntraced(function* (hello: Partial<Pick<Hello, "protocol" | "capabilities">>) {
      const url = yield* machine({ environmentId, workspace, executor: reporting(hello) })
      const environments = yield* environmentsWith(
        EnvironmentAccess.layerFixed([yield* Machine.access({ url, environmentId, brain })]),
      )
      return yield* Effect.scoped(environments.connect(environmentId)).pipe(Effect.flip)
    })
    const newer = yield* refusal({ protocol: 2 })
    expect([newer.reason, newer.message]).toEqual(["incompatible", "The executor speaks protocol 2, not 1"])
    const partial = yield* refusal({ capabilities: ["files"] })
    expect([partial.reason, partial.message]).toEqual(["incompatible", "The executor lacks the capabilities processes"])
  }),
)

it.live("gets a new pass when the executor refuses one the brain still thinks is valid", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const url = yield* Machine.url
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: (id) =>
            Effect.gen(function* () {
              const access = yield* Machine.access({ url, environmentId: id, brain })
              if ((yield* Ref.getAndUpdate(opens, (count) => count + 1)) > 0) return access
              const refused = yield* Machine.access({ url, environmentId: Environment.ID.create(), brain })
              return { ...access, token: refused.token }
            }),
        }),
      ),
    )
    const connection = yield* Effect.scoped(environments.connect(environmentId))
    expect(connection.hello.environmentId).toBe(environmentId)
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.effect("fails clearly once a pass expires while Ren is down, and works again once Ren is back", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const url = yield* Machine.url
    const isDown = yield* Ref.make(false)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: (id) =>
            Effect.gen(function* () {
              if (yield* Ref.get(isDown)) return yield* new EnvironmentAccess.NotFound({ environmentId: id })
              return yield* Machine.access({ url, environmentId: id, brain, issuedAt: yield* Clock.currentTimeMillis })
            }),
        }),
      ),
    )
    const connection = yield* Effect.scoped(environments.connect(environmentId))
    yield* Ref.set(isDown, true)
    yield* TestClock.adjust(Duration.minutes(11))
    expect((yield* connection.client["executor.hello"]().pipe(Effect.flip))._tag).toBe("UnauthorizedError")
    yield* Ref.set(isDown, false)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
  }),
)
