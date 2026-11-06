export * as TestEnvironment from "./test-environment.js"

import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { Signature } from "@ren/schema/signature"
import type { Brain } from "@ren/schema/brain"
import type { Environment } from "@ren/schema/environment"
import { ConfigProvider, DateTime, Effect, Layer, Redacted, Schema, Struct } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { join } from "node:path"
import { Executor } from "../../src/executor.js"
import { Sandbox } from "../../src/sandbox.js"
import { Server } from "../../src/server.js"

export const keys = await Effect.runPromise(Signature.generate("test"))

// oxlint-disable-next-line ren/no-comments -- The executor of another machine: each path it gets lives under root, so a brain on this machine cannot reach the hand's files on its own disk.
export const rooted = (root: string) =>
  Layer.effect(
    Executor.Service,
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      const under = (path: string) => join(root, path)
      return Executor.Service.of({
        ...executor,
        spawn: (brain, input) =>
          executor.spawn(
            brain,
            Struct.assign(input, {
              ...(input.directory && { directory: under(input.directory) }),
              ...(input.outputFile && { outputFile: under(input.outputFile) }),
            }),
          ),
        read: (path, range) => executor.read(under(path), range),
        write: (path, bytes) => executor.write(under(path), bytes),
        stat: (path) => executor.stat(under(path)),
        list: (path) => executor.list(under(path)),
        remove: (path) => executor.remove(under(path)),
        move: (from, to) => executor.move(under(from), under(to)),
        copy: (from, to) => executor.copy(under(from), under(to)),
        mkdir: (path) => executor.mkdir(under(path)),
      })
    }),
  ).pipe(Layer.provide(Sandbox.layer))

export const layer = (options: {
  readonly environmentId: Environment.ID
  readonly workspace: string
  readonly executor?: typeof Sandbox.layer
  readonly publicKeys?: readonly [Signature.PublicKey, ...ReadonlyArray<Signature.PublicKey>]
}) =>
  HttpRouter.serve(Server.layer, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(options.executor ?? Sandbox.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: options.environmentId,
          EXECUTOR_WORKSPACE: options.workspace,
          ENVIRONMENT_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)(options.publicKeys ?? [keys.publicKey]),
        }),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1", idleTimeout: Server.idleTimeoutSeconds })),
  )

export const url = Effect.map(HttpServer.HttpServer, (server) => HttpServer.formatAddress(server.address))

export const access = Effect.fnUntraced(function* (options: {
  readonly url: string
  readonly environmentId: Environment.ID
  readonly directory: string
  readonly brain: Brain.ID
  readonly lifetimeMs?: number
  readonly generation?: number
  readonly egress?: boolean
  readonly issuedAt?: number
}) {
  const expiresAt = DateTime.makeUnsafe((options.issuedAt ?? Date.now()) + (options.lifetimeMs ?? 600_000))
  return {
    directory: options.directory,
    url: new URL(options.url),
    token: Redacted.make(
      yield* EnvironmentToken.sign(keys.privateKey, {
        environment: options.environmentId,
        brain: options.brain,
        exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
      }),
    ),
    expiresAt,
    generation: options.generation ?? 1,
    egress: options.egress ?? false,
  } satisfies Environment.Access
})
