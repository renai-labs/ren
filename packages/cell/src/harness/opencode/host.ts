export * as Host from "./host.js"

import { Credential } from "@opencode/core/credential"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { ServerWorkerd } from "@opencode/server/workerd"
import { Context, Effect, Fiber, Layer, ManagedRuntime, Schema, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import manifest from "../../../package.json"
import { RenPlugin } from "./plugin.js"

export const version = manifest.version

const Providers = Schema.fromJsonString(
  Schema.Struct({ providers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }),
)

export const open = Effect.fn("Host.open")(function* (storage: DurableObjectStorage, config: string) {
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
  )
})

export const make = Effect.fn("Host.make")(function* (
  config: string,
  routes: Layer.Layer<Credential.Service | SdkPlugins.Service | SessionRestart.Service | HttpRouter.HttpRouter, Error>,
): Effect.fn.Return<Instance, Error, Scope.Scope> {
  const configured = Object.keys(
    (yield* Schema.decodeUnknownEffect(Providers)(config).pipe(Effect.orDie)).providers ?? {},
  )
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(routes)),
    (opened) => opened.disposeEffect,
  )
  const services = yield* runtime.contextEffect
  const plugins = Context.get(services, SdkPlugins.Service)
  yield* plugins.register(RenPlugin.make(configured))
  const resuming = runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
  yield* Effect.addFinalizer(() => Fiber.interrupt(resuming))
  return {
    fetch: HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect()),
    credentials: Context.get(services, Credential.Service),
  }
})

export interface Instance {
  readonly fetch: (request: Request) => Promise<Response>
  readonly credentials: Credential.Interface
}
