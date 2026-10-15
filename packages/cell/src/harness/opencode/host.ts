export * as Host from "./host.js"

import { Credential } from "@opencode/core/credential"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { ServerWorkerd } from "@opencode/server/workerd"
import type { Models } from "@ren/schema/models"
import { Context, Effect, Fiber, Layer, ManagedRuntime, Ref, Schema, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import manifest from "../../../package.json"
import type { Harness } from "../harness.js"
import { RenPlugin } from "./plugin.js"

export const version = manifest.version

const Document = Schema.fromJsonString(
  Schema.StructWithRest(Schema.Struct({ providers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
)

export const open = Effect.fn("Host.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  renew: Harness.Renew,
) {
  const options = {
    storage,
    app: { name: "ren-cell", version },
    config: { content: config },
    models: { fetch: false },
  }
  return yield* make(
    config,
    createEmbeddedRoutes(ServerWorkerd.serverOptions(options), ServerWorkerd.replacements(options)).pipe(
      Layer.provide(HttpServer.layerServices),
    ),
    endpoints,
    renew,
  )
})

export const make = Effect.fn("Host.make")(function* (
  config: string,
  routes: Layer.Layer<Credential.Service | SdkPlugins.Service | SessionRestart.Service | HttpRouter.HttpRouter, Error>,
  initial: ReadonlyArray<Models.Endpoint>,
  renew: Harness.Renew,
): Effect.fn.Return<Instance, Error, Scope.Scope> {
  const configured = Object.keys(
    (yield* Schema.decodeUnknownEffect(Document)(config).pipe(Effect.orDie)).providers ?? {},
  )
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(routes)),
    (opened) => opened.disposeEffect,
  )
  const services = yield* runtime.contextEffect
  const plugins = Context.get(services, SdkPlugins.Service)
  const endpoints = yield* Ref.make(initial)
  const reload = yield* Ref.make(Effect.void)
  yield* plugins.register(RenPlugin.make(configured, endpoints, reload, renew))
  const resuming = runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
  yield* Effect.addFinalizer(() => Fiber.interrupt(resuming))
  return {
    fetch: HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect()),
    credentials: Context.get(services, Credential.Service),
    configure: (next) => Ref.set(endpoints, next).pipe(Effect.andThen(Ref.get(reload)), Effect.flatten),
  }
})

export interface Instance {
  readonly fetch: (request: Request) => Promise<Response>
  readonly credentials: Credential.Interface
  readonly configure: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
}
