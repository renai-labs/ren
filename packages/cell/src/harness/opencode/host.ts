export * as Host from "./host.js"

import { Credential } from "@opencode/core/credential"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { ServerWorkerd } from "@opencode/server/workerd"
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { RenPlugin } from "./plugin.js"

const Providers = Schema.fromJsonString(
  Schema.Struct({ providers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }),
)

export const open = Effect.fn("Host.open")(function* (storage: DurableObjectStorage, config: string) {
  const configured = Object.keys(
    (yield* Schema.decodeUnknownEffect(Providers)(config).pipe(Effect.orDie)).providers ?? {},
  )
  const options = {
    storage,
    app: { name: "ren-cell", version: "2.0.27" },
    config: { content: config },
    models: { fetch: false },
  }
  const runtime = ManagedRuntime.make(
    createEmbeddedRoutes(ServerWorkerd.serverOptions(options), ServerWorkerd.replacements(options)).pipe(
      Layer.provide(HttpServer.layerServices),
    ),
  )
  const services = yield* runtime.contextEffect.pipe(Effect.onError(() => runtime.disposeEffect))
  const plugins = Context.get(services, SdkPlugins.Service)
  yield* plugins.register(RenPlugin.make(configured)).pipe(Effect.onError(() => runtime.disposeEffect))
  runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
  return {
    fetch: HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect()),
    credentials: Context.get(services, Credential.Service),
    close: runtime.disposeEffect,
  }
})

export type Instance = Effect.Success<ReturnType<typeof open>>
