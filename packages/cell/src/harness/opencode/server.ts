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
import type { Models } from "@ren/schema/models"
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Option, Ref, type Scope, Struct } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter, HttpServer } from "effect/http"
import manifest from "../../../package.json"
import type { FileSystem } from "@opencode/schema/filesystem"
import { SessionID } from "@opencode/schema/session-id"
import { Harness } from "../harness.js"
import { Credentials } from "./credentials.js"
import { ModelCredentials } from "./model-credentials.js"
import { RenPlugin } from "./plugin.js"
import { RenWorkspaceDriver } from "./workspace-driver.js"

export interface Options {
  readonly saved: Option.Option<Effect.Effect<ReadonlyMap<string, RenPlugin.Chat>>>
  readonly directoryOf: (sessionId: string) => string
  readonly confinement?: RenPlugin.Confinement
  readonly makeDirectory?: (directory: string) => Effect.Effect<void>
}

export const open = Effect.fn("OpenCodeServer.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  options: Options,
) {
  const serverOptions = {
    storage,
    app: { name: "ren-cell", version: manifest.version },
    config: { content: config },
    models: { fetch: false },
  }
  return yield* make(
    createEmbeddedRoutes(ServerWorkerd.serverOptions(serverOptions), [
      ...ServerWorkerd.replacements(serverOptions),
      ...Option.match(connections, {
        onNone: () => [],
        onSome: RenWorkspaceDriver.replacements,
      }),
    ]).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    refreshKey,
    connections,
    options,
  )
})

export const openProcess = Effect.fn("OpenCodeServer.openProcess")(function* (
  database: string,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  options: Options,
) {
  return yield* make(
    createEmbeddedRoutes(
      {
        app: { name: "ren-brain", version: manifest.version },
        database: { path: database },
        config: { project: false, content: config },
        models: { fetch: false },
        fs: { filewatcher: false, fff: false },
      },
      Option.match(connections, { onNone: () => [], onSome: RenWorkspaceDriver.replacements }),
    ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    refreshKey,
    connections,
    options,
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
  options: Options = {
    saved: Option.none(),
    directoryOf: (sessionId) => `/workspace/${sessionId}`,
  },
): Effect.fn.Return<Instance, Error, Scope.Scope> {
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(routes)),
    (opened) => opened.disposeEffect,
  )
  const services = yield* runtime.contextEffect
  const plugins = Context.get(services, SdkPlugins.Service)
  const endpoints = yield* Ref.make(initial)
  const locations = yield* Ref.make<ReadonlyArray<RenPlugin.LocationModels>>([])
  const credentials = Context.get(services, Credential.Service)
  // oxlint-disable-next-line ren/no-comments -- A credential stays while any Location still has its endpoint installed (E64).
  // oxlint-disable-next-line ren/no-comments -- A 401 renews the endpoint's key at once (E58); the caller retries the request one time.
  const renew = Effect.fnUntraced(function* (endpointId: string) {
    const endpoint = (yield* Ref.get(endpoints)).find((each) => each.id === endpointId)
    if (!endpoint) return false
    const renewed = yield* refreshKey(endpointId)
    if (Option.isNone(renewed)) return false
    const entry = ModelCredentials.entries([Struct.evolve(endpoint, { apiKey: () => renewed.value })]).at(0)
    if (!entry) return false
    yield* credentials
      .update(Credentials.idOf(ModelCredentials.owner, entry.integrationID), { value: entry.value })
      .pipe(Effect.orDie)
    return true
  })
  const synced = Effect.gen(function* () {
    const latest = yield* Ref.get(endpoints)
    const installed = yield* Effect.forEach(yield* Ref.get(locations), (location) => Ref.get(location.installed))
    const byId = new Map([...installed.flat(), ...latest].map((endpoint) => [endpoint.id, endpoint]))
    const inUse = [...byId.values()]
    yield* Credentials.sync(credentials, ModelCredentials.owner, ModelCredentials.entries(inUse))
  })
  const loaded = yield* Deferred.make<void>()
  const fetch = HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
  const chats = Option.isSome(options.saved)
    ? Option.some(yield* RenPlugin.chats(yield* options.saved.value))
    : Option.none()
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
  yield* plugins.register(
    RenPlugin.make(
      endpoints,
      locations,
      synced,
      renew,
      loaded,
      refreshKey,
      connections,
      chats,
      Option.fromUndefinedOr(options.confinement),
      approvals,
    ),
  )
  // oxlint-disable-next-line ren/no-comments -- The first request boots OpenCode's location, and the Ren plugin loads after it; a start before that sees an incomplete agent list.
  yield* Effect.promise(() => fetch(new Request("http://opencode/api/agent")))
  yield* Deferred.await(loaded)
  const resuming = runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
  yield* Effect.addFinalizer(() => Fiber.interrupt(resuming))
  return {
    fetch,
    client: api,
    shells: (sessionId, use) => located(sessionId, Shell.Service).pipe(Effect.flatMap(use)),
    agents: (sessionId) => located(sessionId, Agent.Service).pipe(Effect.flatMap((agents) => agents.list())),
    skills: (sessionId) => located(sessionId, Skill.Service).pipe(Effect.flatMap((skills) => skills.list())),
    commands: (sessionId) => located(sessionId, Command.Service).pipe(Effect.flatMap((commands) => commands.list())),
    findFiles: (sessionId, input) =>
      located(sessionId, FileSystemSearch.Service).pipe(Effect.flatMap((search) => search.find(input))),
    webSearchProviders: (sessionId) =>
      located(sessionId, WebSearch.Service).pipe(Effect.flatMap((websearch) => websearch.providers())),
    credentials,
    sessions,
    workspaces: Context.get(services, Workspace.Service),
    hasEnvironmentConnections: Option.isSome(connections),
    directoryOf: options.directoryOf,
    makeDirectory: options.makeDirectory ?? (() => Effect.void),
    activate: (sessionId) => located(sessionId, Effect.void),
    chats,
    configure: (next) =>
      Ref.set(endpoints, next).pipe(
        Effect.andThen(Ref.get(locations)),
        Effect.flatMap((all) => Effect.forEach(all, (location) => location.offer, { discard: true })),
        Effect.andThen(synced),
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
  readonly client: OpenCodeClient
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
  readonly directoryOf: (sessionId: string) => string
  readonly makeDirectory: (directory: string) => Effect.Effect<void>
  readonly activate: (sessionId: string) => Effect.Effect<void, Harness.NotFound>
  readonly chats: Option.Option<RenPlugin.Chats>
  readonly configure: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
}
