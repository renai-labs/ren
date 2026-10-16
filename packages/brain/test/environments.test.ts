import { expect } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { ConfigProvider, Cause, Context, DateTime, Deferred, Effect, Exit, Layer, Ref, Schema, Scope } from "effect"
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
const serve = (id: Environment.ID) =>
  HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(NodeCompatible.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: id,
          EXECUTOR_WORKSPACE: workspace,
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

it.live("concurrent failing connects share one failure and one open", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>()
    const subject = yield* build({ failures: 1, gate })
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
    expect(yield* Ref.get(subject.opens)).toBe(1)
    expect(yield* Ref.get(subject.requests)).toBe(1)
  }),
)

it.live("a failed lookup is not cached and the next connect retries", () =>
  Effect.gen(function* () {
    const subject = yield* build({ failures: 2 })
    const first = yield* Effect.flip(subject.environments.connect(environmentId))
    expect(first.reason).toBe("unreachable")
    const second = yield* Effect.flip(subject.environments.connect(environmentId))
    expect(second.reason).toBe("unreachable")
    const connection = yield* subject.environments.connect(environmentId)
    expect(connection.hello.environmentId).toBe(environmentId)
    expect(yield* Ref.get(subject.opens)).toBe(3)
    expect(yield* Ref.get(subject.requests)).toBe(3)
    expect(yield* subject.environments.connect(environmentId)).toBe(connection)
    expect(yield* Ref.get(subject.opens)).toBe(3)
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
