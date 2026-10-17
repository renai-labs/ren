export * as Host from "./host.js"

import { Credential } from "@opencode/core/credential"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Session } from "@opencode/core/session"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Workspace } from "@opencode/core/workspace"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { ServerWorkerd } from "@opencode/server/workerd"
import type { EnvironmentBindings } from "@ren/brain/environment-bindings"
import type { Environments } from "@ren/brain/environments"
import { OpenCodeWorkspaceDriver } from "@ren/brain/opencode-workspace-driver"
import type { Models } from "@ren/schema/models"
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Option, Ref, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import manifest from "../../../package.json"
import type { Harness } from "../harness.js"
import { RenPlugin } from "./plugin.js"

export const open = Effect.fn("Host.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  environments: Option.Option<{
    readonly environments: Environments.Interface
    readonly bindings: EnvironmentBindings.Interface
  }>,
) {
  const options = {
    storage,
    app: { name: "ren-cell", version: manifest.version },
    config: { content: config },
    models: { fetch: false },
  }
  return yield* make(
    createEmbeddedRoutes(ServerWorkerd.serverOptions(options), [
      ...ServerWorkerd.replacements(options),
      ...Option.match(environments, {
        onNone: () => [],
        onSome: (found) => OpenCodeWorkspaceDriver.replacements(found.environments, found.bindings),
      }),
    ]).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    refreshKey,
    Option.map(environments, (found) => found.bindings),
  )
})

export const make = Effect.fn("Host.make")(function* (
  routes: Layer.Layer<
    | Credential.Service
    | SdkPlugins.Service
    | SessionRestart.Service
    | Session.Service
    | Workspace.Service
    | HttpRouter.HttpRouter,
    Error
  >,
  initial: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  bindings: Option.Option<EnvironmentBindings.Interface>,
): Effect.fn.Return<Instance, Error, Scope.Scope> {
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(routes)),
    (opened) => opened.disposeEffect,
  )
  const services = yield* runtime.contextEffect
  const plugins = Context.get(services, SdkPlugins.Service)
  const endpoints = yield* Ref.make(initial)
  const reloads = yield* Ref.make<ReadonlyArray<Effect.Effect<void>>>([])
  const loaded = yield* Deferred.make<void>()
  yield* plugins.register(RenPlugin.make(endpoints, reloads, loaded, refreshKey, Option.isSome(bindings)))
  const fetch = HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
  // oxlint-disable-next-line ren/no-comments -- The first request boots OpenCode's location, and the Ren plugin loads after it; a start before that sees an incomplete agent list.
  yield* Effect.promise(() => fetch(new Request("http://opencode/api/agent")))
  yield* Deferred.await(loaded)
  const resuming = runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
  yield* Effect.addFinalizer(() => Fiber.interrupt(resuming))
  return {
    fetch,
    credentials: Context.get(services, Credential.Service),
    sessions: Context.get(services, Session.Service),
    workspaces: Context.get(services, Workspace.Service),
    bindings,
    configure: (next) =>
      Ref.set(endpoints, next).pipe(
        Effect.andThen(Ref.get(reloads)),
        Effect.flatMap((all) => Effect.all(all, { discard: true })),
      ),
  }
})

export interface Instance {
  readonly fetch: (request: Request) => Promise<Response>
  readonly credentials: Credential.Interface
  readonly sessions: Session.Interface
  readonly workspaces: Workspace.Interface
  readonly bindings: Option.Option<EnvironmentBindings.Interface>
  readonly configure: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
}
