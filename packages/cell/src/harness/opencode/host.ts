export * as Host from "./host.js"

import { Credential } from "@opencode/core/credential"
import { Model } from "@opencode/core/model"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Variant } from "@opencode/core/variant"
import { Provider } from "@opencode/schema/provider"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { ServerWorkerd } from "@opencode/server/workerd"
import type { Models } from "@ren/schema/models"
import { Context, Effect, Fiber, Layer, ManagedRuntime, Schema, Struct, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import manifest from "../../../package.json"
import { RenPlugin } from "./plugin.js"

export const version = manifest.version

const Document = Schema.fromJsonString(
  Schema.StructWithRest(Schema.Struct({ providers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
)

const protocols = {
  "anthropic-messages": {
    canonical: "anthropic",
    package: "@ai-sdk/anthropic",
    nativePackage: "@opencode/ai/providers/anthropic",
  },
  "openai-responses": {
    canonical: "openai",
    package: "@ai-sdk/openai",
    nativePackage: "@opencode/ai/providers/openai",
  },
  "openai-chat": { package: "@ai-sdk/openai-compatible", nativePackage: "@opencode/ai/providers/openai-compatible" },
} satisfies Record<
  Models.Protocol,
  { readonly canonical?: string; readonly package: string; readonly nativePackage: string }
>

const content = Effect.fn("Host.content")(function* (config: string, endpoints: ReadonlyArray<Models.Endpoint>) {
  const document = yield* Schema.decodeUnknownEffect(Document)(config).pipe(Effect.orDie)
  return JSON.stringify({
    ...document,
    providers: {
      ...document.providers,
      ...Object.fromEntries(
        endpoints.map((endpoint) => [
          endpoint.id,
          {
            ...Struct.omit(protocols[endpoint.protocol], ["nativePackage"]),
            settings: { baseURL: endpoint.baseUrl },
            ...(endpoint.headers && { headers: endpoint.headers }),
            models: Object.fromEntries(
              endpoint.models.map((model) => [
                model.id,
                {
                  ...(model.name && { name: model.name }),
                  ...(model.limit && { limit: model.limit }),
                  ...(model.efforts && {
                    variants: Variant.resolve(
                      {
                        ...Model.Info.default(Provider.ID.make(endpoint.id), Model.ID.make(model.id)),
                        package: protocols[endpoint.protocol].nativePackage,
                        ...(model.limit && { limit: model.limit }),
                      },
                      [{ type: "effort", values: model.efforts }],
                    ),
                  }),
                },
              ]),
            ),
          },
        ]),
      ),
    },
  })
})

export const open = Effect.fn("Host.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
) {
  const merged = yield* content(config, endpoints)
  const options = {
    storage,
    app: { name: "ren-cell", version },
    config: { content: merged },
    models: { fetch: false },
  }
  return yield* make(
    merged,
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
    (yield* Schema.decodeUnknownEffect(Document)(config).pipe(Effect.orDie)).providers ?? {},
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
