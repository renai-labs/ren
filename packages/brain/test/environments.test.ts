import { expect } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import type { Hello } from "@ren/brain-api/executor-api"
import { Signature } from "@ren/brain-api/signature"
import { Executor } from "@ren/executor/executor"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import {
  ConfigProvider,
  Cause,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  PubSub,
  Ref,
  Schema,
  Schedule,
  Scope,
  Stream,
} from "effect"
import { FetchHttpClient, HttpClient, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Environments } from "../src/environments.js"
import { EnvironmentAccess } from "../src/environment-access.js"
import { testEffect } from "./lib/effect.js"

const pair = await Effect.runPromise(Signature.generate("test"))
const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-")))
const serve = (id: Environment.ID, directory = workspace, executor = NodeCompatible.layer) =>
  HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(executor),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: id,
          EXECUTOR_WORKSPACE: directory,
          BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)([pair.publicKey]),
        }),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
  )
const it = testEffect(serve(environmentId))

const accessTo = Effect.fnUntraced(function* (
  server: HttpServer.HttpServer["Service"],
  id: Environment.ID,
  options: { readonly brain: Brain.ID; readonly lifetimeMs: number },
) {
  const expiresAt = DateTime.makeUnsafe(Date.now() + options.lifetimeMs)
  return {
    environmentId: id,
    url: HttpServer.formatAddress(server.address),
    token: yield* EnvironmentToken.sign(pair.privateKey, {
      env: id,
      brain: options.brain,
      exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
    }),
    expiresAt,
    generation: 1,
  }
})

const environmentsWith = (access: Layer.Layer<EnvironmentAccess.Service>) =>
  Layer.build(Environments.layer.pipe(Layer.provide(access), Layer.provide(FetchHttpClient.layer))).pipe(
    Effect.map((context) => Context.get(context, Environments.Service)),
  )

const build = (options: { readonly failures: number; readonly gate?: Deferred.Deferred<void> }) =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const expiresAt = DateTime.makeUnsafe(Date.now() + 600_000)
    const url = HttpServer.formatAddress(server.address)
    const token = yield* EnvironmentToken.sign(pair.privateKey, {
      env: environmentId,
      brain: Brain.ID.create(),
      exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
    })
    const access = { environmentId, url, token, expiresAt, generation: 1 }
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
    const testScope = yield* Scope.Scope
    const scope = yield* Scope.fork(testScope)
    const environments = yield* Layer.buildWithScope(
      Environments.layer.pipe(Layer.provide(host), Layer.provide(http)),
      scope,
    ).pipe(Effect.map((context) => Context.get(context, Environments.Service)))
    return { environments, scope, opens, requests }
  })

it.live("concurrent first connects share one client and one hello", () =>
  Effect.gen(function* () {
    const subject = yield* build({ failures: 0 })
    const connections = yield* Effect.all(
      Array.from({ length: 10 }, () => subject.environments.connect(environmentId)),
      { concurrency: "unbounded" },
    )
    expect(new Set(connections.map((connection) => connection.client)).size).toBe(1)
    expect(yield* Ref.get(subject.opens)).toBe(1)
    expect(yield* Ref.get(subject.requests)).toBe(1)
    const again = yield* subject.environments.connect(environmentId)
    expect(connections.every((connection) => connection === again)).toBe(true)
    expect(yield* Ref.get(subject.requests)).toBe(1)
  }),
)

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

it.live("caches each environment on its own, and one's failure leaves another's connection", () =>
  Effect.gen(function* () {
    const second = Environment.ID.create()
    const missing = Environment.ID.create()
    const brain = Brain.ID.create()
    const first = yield* HttpServer.HttpServer
    const other = Context.get(yield* Layer.build(Layer.fresh(serve(second))), HttpServer.HttpServer)
    const environments = yield* environmentsWith(
      EnvironmentAccess.layerFixed([
        yield* accessTo(first, environmentId, { brain, lifetimeMs: 600_000 }),
        yield* accessTo(other, second, { brain, lifetimeMs: 600_000 }),
        yield* accessTo(first, missing, { brain, lifetimeMs: 600_000 }),
      ]),
    )
    const connections = yield* Effect.all([environments.connect(environmentId), environments.connect(second)])
    expect(connections.map((connection) => connection.hello.environmentId)).toEqual([environmentId, second])
    expect((yield* environments.connect(missing).pipe(Effect.flip)).reason).toBe("unreachable")
    expect(yield* environments.connect(environmentId)).toBe(connections[0])
    expect(yield* environments.connect(second)).toBe(connections[1])
  }),
)

it.live("a connection outlives its token, and still reaches the processes it started", () =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const brain = Brain.ID.create()
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: (id) =>
            Ref.update(opens, (count) => count + 1).pipe(
              Effect.andThen(accessTo(server, id, { brain, lifetimeMs: 2_000 })),
            ),
        }),
      ),
    )
    const connection = yield* environments.connect(environmentId)
    const spawned = yield* connection.client["process.spawn"]({ command: "sleep", arguments: ["30"] })
    yield* Effect.sleep(3_000)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
    const current = yield* environments.connect(environmentId)
    expect((yield* current.client["executor.hello"]()).environmentId).toBe(environmentId)
    yield* current.client["process.kill"]({ id: spawned.id, signal: "SIGKILL" })
    expect(yield* Ref.get(opens)).toBeGreaterThan(1)
  }),
)

it.live("refreshes a token in its last five minutes, once for many concurrent calls", () =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const brain = Brain.ID.create()
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: (id) =>
            Ref.update(opens, (count) => count + 1).pipe(
              Effect.andThen(accessTo(server, id, { brain, lifetimeMs: 5 * 60_000 + 1_500 })),
            ),
        }),
      ),
    )
    const connection = yield* environments.connect(environmentId)
    expect(yield* Ref.get(opens)).toBe(1)
    yield* Effect.sleep(2_000)
    yield* Effect.all(
      Array.from({ length: 10 }, () => connection.client["executor.hello"]()),
      { concurrency: "unbounded" },
    )
    expect(yield* Ref.get(opens)).toBe(2)
    yield* connection.client["executor.hello"]()
    expect(yield* Ref.get(opens)).toBe(2)
  }),
)

it.live("keeps using a token it could not refresh until the token expires", () =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
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
                  ? accessTo(server, id, { brain, lifetimeMs: 60_000 })
                  : Effect.fail(new EnvironmentAccess.NotFound({ environmentId: id })),
              ),
            ),
        }),
      ),
    )
    const connection = yield* environments.connect(environmentId)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
    expect(yield* Ref.get(opens)).toBeGreaterThan(1)
  }),
)

it.live("a connection stays cached until the layer closes, then its client is interrupted", () =>
  Effect.gen(function* () {
    const subject = yield* build({ failures: 0 })
    const connection = yield* subject.environments.connect(environmentId)
    expect(yield* subject.environments.connect(environmentId)).toBe(connection)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
    yield* Scope.close(subject.scope, Exit.void)
    const exit = yield* Effect.exit(connection.client["executor.hello"]())
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
  }),
)

const memoryAccess = Effect.fnUntraced(function* (options: { readonly brain: Brain.ID }) {
  const server = yield* HttpServer.HttpServer
  const access = yield* accessTo(server, environmentId, { brain: options.brain, lifetimeMs: 600_000 })
  const context = yield* Layer.build(EnvironmentAccess.layerMemory([access]))
  return {
    access,
    memory: Context.get(context, EnvironmentAccess.Memory),
    environments: yield* environmentsWith(Layer.succeedContext(context)),
  }
})

const settle = Effect.sleep(50)

const eventually = <A, E, R>(attempt: Effect.Effect<A, E, R>, isDone: (value: A) => boolean) =>
  attempt.pipe(Effect.repeat({ until: isDone, schedule: Schedule.spaced(10) }), Effect.timeout(5_000))

it.live("keeps the connection when only the environment's token changes", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const subject = yield* memoryAccess({ brain })
    const connection = yield* subject.environments.connect(environmentId)
    yield* subject.memory.set(
      yield* accessTo(yield* HttpServer.HttpServer, environmentId, { brain, lifetimeMs: 900_000 }),
    )
    yield* settle
    expect(yield* subject.environments.connect(environmentId)).toBe(connection)
  }),
)

it.live(
  "connects again when the environment's machine is replaced, and the old connection still serves its holders",
  () =>
    Effect.gen(function* () {
      const subject = yield* memoryAccess({ brain: Brain.ID.create() })
      const connection = yield* subject.environments.connect(environmentId)
      yield* subject.memory.set({ ...subject.access, generation: 2 })
      const replaced = yield* eventually(subject.environments.connect(environmentId), (next) => next !== connection)
      expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
      expect((yield* replaced.client["executor.hello"]()).environmentId).toBe(environmentId)
    }),
)

it.live("stops connecting to an environment once its access is removed", () =>
  Effect.gen(function* () {
    const subject = yield* memoryAccess({ brain: Brain.ID.create() })
    yield* subject.environments.connect(environmentId)
    yield* subject.memory.remove(environmentId)
    const exit = yield* eventually(Effect.exit(subject.environments.connect(environmentId)), Exit.isFailure)
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ reason: "not_found" })
  }),
)

it.live("closes a replaced connection once its last holder lets it go", () =>
  Effect.gen(function* () {
    const subject = yield* memoryAccess({ brain: Brain.ID.create() })
    const holder = yield* Scope.make()
    const connection = yield* subject.environments.connect(environmentId).pipe(Scope.provide(holder))
    yield* subject.memory.set({ ...subject.access, generation: 2 })
    yield* eventually(Effect.scoped(subject.environments.connect(environmentId)), (next) => next !== connection)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
    yield* Scope.close(holder, Exit.void)
    const exit = yield* Effect.exit(connection.client["executor.hello"]())
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
  }),
)

const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "ren-environments-elsewhere-")))

const served = Effect.map(HttpServer.HttpServer, (server) => HttpServer.formatAddress(server.address))

const machine = (directory: string, executor = NodeCompatible.layer) =>
  Effect.map(Layer.build(Layer.fresh(serve(environmentId, directory, executor))), (context) =>
    HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address),
  )

const accessAt = Effect.fnUntraced(function* (
  url: string,
  options: {
    readonly brain: Brain.ID
    readonly lifetimeMs: number
    readonly tokenLifetimeMs?: number
    readonly generation?: number
  },
) {
  return {
    environmentId,
    url,
    token: yield* EnvironmentToken.sign(pair.privateKey, {
      env: environmentId,
      brain: options.brain,
      exp: Math.floor((Date.now() + (options.tokenLifetimeMs ?? options.lifetimeMs)) / 1000),
    }),
    expiresAt: DateTime.makeUnsafe(Date.now() + options.lifetimeMs),
    generation: options.generation ?? 1,
  }
})

const controlled = Effect.fnUntraced(function* (initial: Environment.Access) {
  const current = yield* Ref.make(initial)
  const changed = yield* PubSub.unbounded<Environment.ID>()
  const gate = yield* Ref.make(Option.none<Deferred.Deferred<void>>())
  const environments = yield* environmentsWith(
    Layer.succeed(
      EnvironmentAccess.Service,
      EnvironmentAccess.Service.of({
        open: () =>
          Effect.gen(function* () {
            const snapshot = yield* Ref.get(current)
            const held = yield* Ref.getAndSet(gate, Option.none())
            if (Option.isSome(held)) yield* Deferred.await(held.value)
            return snapshot
          }),
        subscribe: PubSub.subscribe(changed).pipe(Effect.map(Stream.fromSubscription)),
      }),
    ),
  )
  return {
    current,
    environments,
    notify: PubSub.publish(changed, environmentId),
    holdNextOpen: Effect.tap(Deferred.make<void>(), (deferred) => Ref.set(gate, Option.some(deferred))),
  }
})

const where = (environments: Environments.Interface) =>
  Effect.scoped(
    Effect.flatMap(environments.connect(environmentId), (connection) => connection.client["executor.hello"]()),
  ).pipe(Effect.map((hello) => hello.workspaceDirectory))

it.live("moves to the new machine when a renewed pass names a new address, with no change message", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const second = yield* machine(elsewhere)
    const subject = yield* controlled(yield* accessAt(yield* served, { brain, lifetimeMs: 5 * 60_000 + 1_000 }))
    expect(yield* where(subject.environments)).toBe(workspace)
    yield* Ref.set(subject.current, yield* accessAt(second, { brain, lifetimeMs: 600_000 }))
    yield* Effect.sleep(1_500)
    yield* where(subject.environments)
    expect(yield* where(subject.environments)).toBe(elsewhere)
  }),
)

it.live("moves to the new machine when the change message comes after a renewal already saw the new address", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const second = yield* machine(elsewhere)
    const subject = yield* controlled(yield* accessAt(yield* served, { brain, lifetimeMs: 5 * 60_000 + 1_000 }))
    yield* where(subject.environments)
    yield* Ref.set(subject.current, yield* accessAt(second, { brain, lifetimeMs: 600_000 }))
    yield* Effect.sleep(1_500)
    yield* where(subject.environments)
    yield* subject.notify
    expect(
      yield* eventually(where(subject.environments), (directory) => directory === elsewhere).pipe(Effect.option),
    ).toEqual(Option.some(elsewhere))
  }),
)

it.live("a change during the first connect leaves the next call on the new machine", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const second = yield* machine(elsewhere)
    const subject = yield* controlled(yield* accessAt(yield* served, { brain, lifetimeMs: 600_000 }))
    const gate = yield* subject.holdNextOpen
    const first = yield* Effect.forkScoped(where(subject.environments))
    yield* Effect.sleep(50)
    yield* Ref.set(subject.current, yield* accessAt(second, { brain, lifetimeMs: 600_000 }))
    yield* subject.notify
    yield* settle
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(first)
    expect(yield* eventually(where(subject.environments), (directory) => directory === elsewhere)).toBe(elsewhere)
  }),
)

it.live("an older answer from Ren that arrives after a newer one does not bring the old machine back", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const second = yield* machine(elsewhere)
    const subject = yield* controlled(yield* accessAt(yield* served, { brain, lifetimeMs: 5 * 60_000 + 1_000 }))
    yield* where(subject.environments)
    yield* Effect.sleep(1_500)
    const gate = yield* subject.holdNextOpen
    const renewing = yield* Effect.forkScoped(where(subject.environments))
    yield* Effect.sleep(50)
    yield* Ref.set(subject.current, yield* accessAt(second, { brain, lifetimeMs: 600_000 }))
    yield* subject.notify
    yield* settle
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(renewing)
    expect(yield* eventually(where(subject.environments), (directory) => directory === elsewhere)).toBe(elsewhere)
    yield* settle
    expect(yield* where(subject.environments)).toBe(elsewhere)
  }),
)

it.live("fifty token changes keep one connection, and twenty replacements leave only the newest open", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const server = yield* HttpServer.HttpServer
    const subject = yield* memoryAccess({ brain })
    const connection = yield* Effect.scoped(subject.environments.connect(environmentId))
    yield* Effect.forEach(
      Array.from({ length: 50 }),
      () =>
        Effect.flatMap(accessTo(server, environmentId, { brain, lifetimeMs: 900_000 }), (access) =>
          subject.memory.set(access),
        ),
      { discard: true },
    )
    yield* settle
    expect(yield* Effect.scoped(subject.environments.connect(environmentId))).toBe(connection)
    const latest = yield* Ref.make(connection)
    const replaced = yield* Effect.forEach(
      Array.from({ length: 20 }, (_, index) => index + 2),
      (generation) =>
        Effect.gen(function* () {
          const previous = yield* Ref.get(latest)
          yield* subject.memory.set({ ...subject.access, generation })
          const next = yield* eventually(
            Effect.scoped(subject.environments.connect(environmentId)),
            (candidate) => candidate !== previous,
          )
          yield* Ref.set(latest, next)
          return next
        }),
    )
    const unique = [...new Set([connection, ...replaced])]
    expect(unique.length).toBe(21)
    const live = yield* Effect.forEach(unique, (each) =>
      Effect.exit(each.client["executor.hello"]()).pipe(Effect.map(Exit.isSuccess)),
    )
    expect(live.filter(Boolean).length).toBe(1)
    expect(live.at(-1)).toBe(true)
  }),
)

it.live("a quick change to another machine and back ends on the first machine", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const first = yield* served
    const second = yield* machine(elsewhere)
    const subject = yield* controlled(yield* accessAt(first, { brain, lifetimeMs: 600_000 }))
    yield* where(subject.environments)
    yield* Ref.set(subject.current, yield* accessAt(second, { brain, lifetimeMs: 600_000 }))
    yield* subject.notify
    yield* Ref.set(subject.current, yield* accessAt(first, { brain, lifetimeMs: 600_000 }))
    yield* subject.notify
    yield* settle
    expect(yield* where(subject.environments)).toBe(workspace)
  }),
)

it.live("a change to one environment leaves another environment's connection alone", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const secondId = Environment.ID.create()
    const other = Context.get(yield* Layer.build(Layer.fresh(serve(secondId))), HttpServer.HttpServer)
    const firstAccess = yield* accessTo(yield* HttpServer.HttpServer, environmentId, { brain, lifetimeMs: 600_000 })
    const secondAccess = yield* accessTo(other, secondId, { brain, lifetimeMs: 600_000 })
    const context = yield* Layer.build(EnvironmentAccess.layerMemory([firstAccess, secondAccess]))
    const memory = Context.get(context, EnvironmentAccess.Memory)
    const environments = yield* environmentsWith(Layer.succeedContext(context))
    const kept = yield* Effect.scoped(environments.connect(environmentId))
    const moved = yield* Effect.scoped(environments.connect(secondId))
    yield* memory.set({ ...secondAccess, generation: 2 })
    yield* eventually(Effect.scoped(environments.connect(secondId)), (next) => next !== moved)
    expect(yield* Effect.scoped(environments.connect(environmentId))).toBe(kept)
  }),
)

const reporting = (hello: Pick<Partial<Hello>, "protocol" | "capabilities">) =>
  Layer.effect(
    Executor.Service,
    Effect.map(Executor.Service, (executor) =>
      Executor.Service.of({
        hello: {
          protocol: hello.protocol ?? executor.hello.protocol,
          capabilities: hello.capabilities ?? executor.hello.capabilities,
          version: executor.hello.version,
          environmentId: executor.hello.environmentId,
          workspaceDirectory: executor.hello.workspaceDirectory,
          os: executor.hello.os,
          arch: executor.hello.arch,
        },
        spawn: executor.spawn,
        output: executor.output,
        writeStdin: executor.writeStdin,
        heartbeat: executor.heartbeat,
        kill: executor.kill,
        read: executor.read,
        write: executor.write,
        stat: executor.stat,
        list: executor.list,
        remove: executor.remove,
        move: executor.move,
        mkdir: executor.mkdir,
      }),
    ),
  ).pipe(Layer.provide(NodeCompatible.layer))

it.live("refuses an executor that speaks another protocol or lacks a capability", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const refusal = Effect.fnUntraced(function* (hello: Pick<Partial<Hello>, "protocol" | "capabilities">) {
      const url = yield* machine(workspace, reporting(hello))
      const environments = yield* environmentsWith(
        EnvironmentAccess.layerFixed([yield* accessAt(url, { brain, lifetimeMs: 600_000 })]),
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
    const url = yield* served
    const opens = yield* Ref.make(0)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: () =>
            Ref.getAndUpdate(opens, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                accessAt(url, { brain, lifetimeMs: 600_000, tokenLifetimeMs: count === 0 ? 2_000 : 600_000 }),
              ),
            ),
        }),
      ),
    )
    const connection = yield* Effect.scoped(environments.connect(environmentId))
    yield* Effect.sleep(3_000)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
  }),
)

it.live("fails clearly once a pass expires while Ren is down, and works again once Ren is back", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const url = yield* served
    const isDown = yield* Ref.make(false)
    const environments = yield* environmentsWith(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          subscribe: Effect.succeed(Stream.never),
          open: (id) =>
            Effect.flatMap(Ref.get(isDown), (down) =>
              down
                ? Effect.fail(new EnvironmentAccess.NotFound({ environmentId: id }))
                : accessAt(url, { brain, lifetimeMs: 2_000 }),
            ),
        }),
      ),
    )
    const connection = yield* Effect.scoped(environments.connect(environmentId))
    yield* Ref.set(isDown, true)
    yield* Effect.sleep(3_000)
    expect((yield* connection.client["executor.hello"]().pipe(Effect.flip))._tag).toBe("UnauthorizedError")
    yield* Ref.set(isDown, false)
    expect((yield* connection.client["executor.hello"]()).environmentId).toBe(environmentId)
  }),
)
