export * as Host from "./host.js"

import { Agent } from "@opencode/core/agent"
import { Command } from "@opencode/core/command"
import { Credential } from "@opencode/core/credential"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
// ast-grep-ignore: no-import-alias -- this module declares the cell's own Instance, and OpenCode's is a value
import { Instance as OpenCodeInstance } from "@opencode/core/instance/service"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Session } from "@opencode/core/session"
import { Shell } from "@opencode/core/shell"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { Skill } from "@opencode/core/skill"
import { Workspace } from "@opencode/core/workspace"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { ServerWorkerd } from "@opencode/server/workerd"
import type { Environments } from "@ren/brain/environments"
import type { Models } from "@ren/schema/models"
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Option, Ref, type Scope } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import manifest from "../../../package.json"
import type { FileSystem } from "@opencode/schema/filesystem"
import { SessionID } from "@opencode/schema/session-id"
import { Harness } from "../harness.js"
import { RenPlugin } from "./plugin.js"
import { RenWorkspaceDriver } from "./ren-workspace-driver.js"

export const open = Effect.fn("Host.open")(function* (
  storage: DurableObjectStorage,
  config: string,
  endpoints: ReadonlyArray<Models.Endpoint>,
  refreshKey: Harness.Refresh,
  environments: Option.Option<Environments.Interface>,
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
        onSome: RenWorkspaceDriver.replacements,
      }),
    ]).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    refreshKey,
    Option.isSome(environments),
  )
})

export const make = Effect.fn("Host.make")(function* (
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
  hasEnvironments: boolean,
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
  yield* plugins.register(RenPlugin.make(endpoints, reloads, loaded, refreshKey, hasEnvironments))
  const fetch = HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
  // oxlint-disable-next-line ren/no-comments -- The first request boots OpenCode's location, and the Ren plugin loads after it; a start before that sees an incomplete agent list.
  yield* Effect.promise(() => fetch(new Request("http://opencode/api/agent")))
  yield* Deferred.await(loaded)
  const resuming = runtime.runFork(Context.get(services, SessionRestart.Service).resumeSuspendedSessions)
  yield* Effect.addFinalizer(() => Fiber.interrupt(resuming))
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
  return {
    fetch,
    shells: (sessionId, use) => located(sessionId, Shell.Service).pipe(Effect.flatMap(use)),
    agents: (sessionId) => located(sessionId, Agent.Service).pipe(Effect.flatMap((agents) => agents.list())),
    skills: (sessionId) => located(sessionId, Skill.Service).pipe(Effect.flatMap((skills) => skills.list())),
    commands: (sessionId) => located(sessionId, Command.Service).pipe(Effect.flatMap((commands) => commands.list())),
    findFiles: (sessionId, input) =>
      located(sessionId, FileSystemSearch.Service).pipe(Effect.flatMap((search) => search.find(input))),
    credentials: Context.get(services, Credential.Service),
    sessions,
    workspaces: Context.get(services, Workspace.Service),
    hasEnvironments,
    configure: (next) =>
      Ref.set(endpoints, next).pipe(
        Effect.andThen(Ref.get(reloads)),
        Effect.flatMap((all) => Effect.all(all, { discard: true })),
      ),
  }
})

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
  readonly credentials: Credential.Interface
  readonly sessions: Session.Interface
  readonly workspaces: Workspace.Interface
  readonly hasEnvironments: boolean
  readonly configure: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
}
