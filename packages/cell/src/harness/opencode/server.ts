export * as OpenCodeServer from "./server.js"

import { Agent } from "@opencode/core/agent"
import { Command } from "@opencode/core/command"
import { Credential } from "@opencode/core/credential"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
// ast-grep-ignore: no-import-alias -- this module declares the cell's own Instance, and OpenCode's is a value
import { Instance as OpenCodeInstance } from "@opencode/core/instance/service"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Session } from "@opencode/core/session"
import { Shell } from "@opencode/core/shell"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Skill } from "@opencode/core/skill"
import { WebSearch } from "@opencode/core/websearch"
import { Workspace } from "@opencode/core/workspace"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { ServerWorkerd } from "@opencode/server/workerd"
import type { EnvironmentConnections } from "@ren/brain/environment/connections"
import { OpenCode, type OpenCodeClient } from "@opencode/client/effect"
import { BrainSettings } from "@ren/brain/settings"
import type { Models } from "@ren/schema/models"
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Option, Ref, type Scope } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer } from "effect/http"
import manifest from "../../../package.json"
import type { FileSystem } from "@opencode/schema/filesystem"
import { SessionID } from "@opencode/schema/session-id"
import { Harness } from "../harness.js"
import { RenPlugin } from "./plugin.js"
import { RenWorkspaceDriver } from "./workspace-driver.js"
import { SessionSettings } from "./session-settings.js"

export const open = Effect.fn("OpenCodeServer.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  settings: Option.Option<Pick<BrainSettings.Host, "read">>,
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
      ...Option.match(connections, {
        onNone: () => [],
        onSome: RenWorkspaceDriver.replacements,
      }),
    ]).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    refreshKey,
    connections,
    settings,
  )
})

export const make = Effect.fn("OpenCodeServer.make")(function* (
  routes: Layer.Layer<
    | Credential.Service
    | SdkPlugins.Service
    | SessionRestart.Service
    | Session.Service
    | Workspace.Service
    | OpenCodeInstance.Service
    | HttpRouter.HttpRouter,
    Error
  >,
  initial: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  settings: Option.Option<Pick<BrainSettings.Host, "read">> = Option.none(),
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
  const fetch = HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
  const shared = yield* Option.match(settings, {
    onNone: () => Effect.succeedNone,
    onSome: (host) =>
      BrainSettings.make({
        read: host.read,
        available: (model) =>
          client(fetch).pipe(
            Effect.flatMap((opened) => opened.model.list()),
            Effect.orDie,
            Effect.map((page) =>
              page.data.some(
                (item) =>
                  item.providerID === model.endpointId &&
                  item.modelID === model.modelId &&
                  (!model.variant || item.variants.some((variant) => variant.id === model.variant)),
              ),
            ),
          ),
      }).pipe(Effect.flatMap(RenPlugin.settings), Effect.map(Option.some)),
  })
  const sessions = Context.get(services, Session.Service)
  const instances = Context.get(services, OpenCodeInstance.Service)
  const located = <S, R>(sessionId: string, service: Effect.Effect<S, never, R>) =>
    sessions.get(SessionID.make(sessionId)).pipe(
      Effect.catchTag("Session.NotFoundError", () =>
        Effect.fail(new Harness.NotFound({ message: `Session ${sessionId} is not in this brain` })),
      ),
      Effect.flatMap((session) =>
        Plugin.awaitActivation.pipe(Effect.andThen(service), instances.provide(session), Effect.orDie),
      ),
    )
  const api = yield* client(fetch)
  const approvals = (sessionId: string) =>
    located(sessionId, Location.Service).pipe(
      Effect.flatMap((location) => api.permission.saved.list({ projectID: location.project.id }).pipe(Effect.orDie)),
    )
  yield* plugins.register(RenPlugin.make(endpoints, reloads, loaded, refreshKey, connections, shared, approvals))
  // oxlint-disable-next-line ren/no-comments -- The first request boots OpenCode's location, and the Ren plugin loads after it; a start before that sees an incomplete agent list.
  yield* Effect.promise(() => fetch(new Request("http://opencode/api/agent")))
  yield* Deferred.await(loaded)
  if (Option.isSome(shared)) {
    const opened = yield* client(fetch)
    const root = (yield* opened.session.list({ parentID: null, limit: 1 }).pipe(Effect.orDie)).data.at(0)
    if (root) {
      const saved = Option.getOrUndefined(SessionSettings.savedOf(root))
      yield* shared.value.control.configure({
        sessionId: root.id,
        interactive: saved?.interactive ?? true,
        model: Option.fromNullishOr(saved?.model),
      })
    } else
      yield* shared.value.control.pull.pipe(
        Effect.catch((error) => Effect.logWarning(`Opened without settings: ${error.message}`)),
      )
  }
  const resuming = runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
  yield* Effect.addFinalizer(() => Fiber.interrupt(resuming))
  return {
    fetch,
    shells: (sessionId, use) => located(sessionId, Shell.Service).pipe(Effect.flatMap(use)),
    agents: (sessionId) => located(sessionId, Agent.Service).pipe(Effect.flatMap((agents) => agents.list())),
    skills: (sessionId) => located(sessionId, Skill.Service).pipe(Effect.flatMap((skills) => skills.list())),
    commands: (sessionId) => located(sessionId, Command.Service).pipe(Effect.flatMap((commands) => commands.list())),
    findFiles: (sessionId, input) =>
      located(sessionId, FileSystemSearch.Service).pipe(Effect.flatMap((search) => search.find(input))),
    webSearchProviders: (sessionId) =>
      located(sessionId, WebSearch.Service).pipe(Effect.flatMap((websearch) => websearch.providers())),
    credentials: Context.get(services, Credential.Service),
    sessions,
    workspaces: Context.get(services, Workspace.Service),
    hasEnvironmentConnections: Option.isSome(connections),
    settings: Option.map(shared, (each) => each.control),
    configure: (next) =>
      Ref.set(endpoints, next).pipe(
        Effect.andThen(Ref.get(reloads)),
        Effect.flatMap((all) => Effect.all(all, { discard: true })),
      ),
  }
})

export const client = (fetch: (request: Request) => Promise<Response>): Effect.Effect<OpenCodeClient> =>
  OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(Layer.fresh(FetchHttpClient.layer)),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) => fetch(new Request(input, init))),
  )

export interface Instance {
  readonly fetch: (request: Request) => Promise<Response>
  readonly shells: <A, E>(
    sessionId: string,
    use: (shell: Shell.Interface) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | Harness.NotFound>
  readonly agents: (sessionId: string) => Effect.Effect<ReadonlyArray<Agent.Info>, Harness.NotFound>
  readonly skills: (sessionId: string) => Effect.Effect<ReadonlyArray<Skill.Info>, Harness.NotFound>
  readonly commands: (sessionId: string) => Effect.Effect<ReadonlyArray<Command.Info>, Harness.NotFound>
  readonly findFiles: (
    sessionId: string,
    input: FileSystem.FindInput,
  ) => Effect.Effect<ReadonlyArray<FileSystem.Entry>, Harness.NotFound>
  readonly webSearchProviders: (sessionId: string) => Effect.Effect<ReadonlyArray<WebSearch.Provider>, Harness.NotFound>
  readonly credentials: Credential.Interface
  readonly sessions: Session.Interface
  readonly workspaces: Workspace.Interface
  readonly hasEnvironmentConnections: boolean
  readonly settings: Option.Option<RenPlugin.Settings>
  readonly configure: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
}
