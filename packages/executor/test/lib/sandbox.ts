export * as Sandbox from "./sandbox.js"

import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/hand-api/environment-token"
import { Signature } from "@ren/hand-api/signature"
import type { Brain } from "@ren/schema/brain"
import type { Environment } from "@ren/schema/environment"
import type { Hand } from "@ren/schema/hand"
import { ConfigProvider, DateTime, Effect, Layer, Redacted, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { Machine } from "../../src/machine.js"
import { Server } from "../../src/server.js"

export const keys = await Effect.runPromise(Signature.generate("test"))

export const layer = (options: {
  readonly environmentId: Environment.ID
  readonly workspace: string
  readonly executor?: typeof Machine.layer
  readonly publicKeys?: readonly [Signature.PublicKey, ...ReadonlyArray<Signature.PublicKey>]
}) =>
  HttpRouter.serve(Server.layer, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(options.executor ?? Machine.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: options.environmentId,
          EXECUTOR_WORKSPACE: options.workspace,
          BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)(options.publicKeys ?? [keys.publicKey]),
        }),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
  )

export const url = Effect.map(HttpServer.HttpServer, (server) => HttpServer.formatAddress(server.address))

export const access = Effect.fnUntraced(function* (options: {
  readonly url: string
  readonly environmentId: Environment.ID
  readonly directory: string
  readonly brain: Brain.ID
  readonly lifetimeMs?: number
  readonly generation?: number
  readonly issuedAt?: number
}) {
  const expiresAt = DateTime.makeUnsafe((options.issuedAt ?? Date.now()) + (options.lifetimeMs ?? 600_000))
  return {
    directory: options.directory,
    url: new URL(options.url),
    token: Redacted.make(
      yield* EnvironmentToken.sign(keys.privateKey, {
        env: options.environmentId,
        brain: options.brain,
        exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
      }),
    ),
    expiresAt,
    generation: options.generation ?? 1,
  } satisfies Hand.Access
})
