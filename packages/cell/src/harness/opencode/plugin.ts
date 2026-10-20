export * as RenPlugin from "./plugin.js"

import { Plugin } from "@opencode/plugin/effect"
import type { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Agent, Model, Provider } from "@opencode/client/effect"
import type { Session as OpenCodeSession } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { BrainSettings } from "@ren/brain/settings"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import {
  Clock,
  DateTime,
  Deferred,
  Effect,
  Option,
  Predicate,
  Record,
  Redacted,
  Ref,
  Schema,
  Semaphore,
  Stream,
  Struct,
} from "effect"
import type { Harness } from "../harness.js"
import { ModelProviders } from "./model-providers.js"
import { RenWorkspaceDriver } from "./workspace-driver.js"

const environmentTools = ["read", "write", "edit", "patch", "glob", "grep", "shell"]

export const method = IntegrationMethodID.make("ren")

export class ManagedKeyError extends Schema.TaggedError<ManagedKeyError>()("ManagedKeyError", {
  message: Schema.String,
}) {}

const never = Number.MAX_SAFE_INTEGER

const rank = { allow: 0, ask: 1, deny: 2 } as const

export interface Settings {
  readonly configure: (session: {
    readonly sessionId: OpenCodeSession.ID
    readonly interactive: boolean
    readonly model: Option.Option<Session.Model>
  }) => Effect.Effect<BrainSettings.Resolved, BrainSettings.Failure>
  readonly pull: Effect.Effect<BrainSettings.Resolved, BrainSettings.Failure>
  readonly setModel: (
    model: Option.Option<Session.Model>,
  ) => Effect.Effect<BrainSettings.Resolved, BrainSettings.Failure>
}

interface Instance {
  readonly reload: Effect.Effect<void>
  readonly session: Plugin.Context["session"]
}

interface Shared {
  readonly current: Ref.Ref<Option.Option<BrainSettings.Resolved>>
  readonly attached: Ref.Ref<Option.Option<{ readonly sessionId: OpenCodeSession.ID; readonly interactive: boolean }>>
  readonly instances: Ref.Ref<ReadonlyArray<Instance>>
  readonly control: Settings
}

export const sameModel = (
  current: { readonly providerID: string; readonly id: string; readonly variant?: string | undefined } | undefined,
  model: Session.Model,
) =>
  current?.providerID === model.endpointId &&
  current.id === model.modelId &&
  (current.variant ?? "default") === (model.variant ?? "default")

export const modelRef = (model: Session.Model) => ({
  providerID: Provider.ID.make(model.endpointId),
  id: Model.ID.make(model.modelId),
  ...(model.variant && { variant: Model.VariantID.make(model.variant) }),
})

const withoutModel = (value: unknown) =>
  Predicate.isObject(value) ? Record.filter(value, (_, key) => key !== "model") : value

const maxErrorDepth = 8

const environmentFailure = (value: unknown, depth = 0): { readonly message: string } | undefined => {
  const failure = EnvironmentConnections.failureOf(value)
  if (failure) return failure
  if (depth > maxErrorDepth || !Predicate.isObject(value)) return undefined
  return ["cause", "error", "reason"]
    .map((key) => (Predicate.hasProperty(value, key) ? environmentFailure(value[key], depth + 1) : undefined))
    .find(Boolean)
}

export const refresh = Effect.fn("RenPlugin.refresh")(function* (
  endpointId: string,
  credential: Credential.OAuth,
  refreshKey: Harness.Refresh,
) {
  const refreshed = yield* refreshKey(endpointId)
  if (Option.isSome(refreshed))
    return Struct.evolve(credential, {
      access: () => Redacted.value(refreshed.value.key),
      expires: () => (refreshed.value.expiresAt ? DateTime.toEpochMillis(refreshed.value.expiresAt) : never),
    })
  if ((yield* Clock.currentTimeMillis) < credential.expires) return credential
  return yield* new ManagedKeyError({
    message: `The model key for endpoint ${endpointId} expired at ${DateTime.formatIso(DateTime.makeUnsafe(credential.expires))}`,
  })
})

export const settings = Effect.fnUntraced(function* (brain: BrainSettings.Interface) {
  const current = yield* Ref.make(Option.none<BrainSettings.Resolved>())
  const attached = yield* Ref.make(
    Option.none<{ readonly sessionId: OpenCodeSession.ID; readonly interactive: boolean }>(),
  )
  const instances = yield* Ref.make<ReadonlyArray<Instance>>([])
  const changes = yield* Semaphore.make(1)
  const apply = (update: Effect.Effect<BrainSettings.Resolved, BrainSettings.Failure>) =>
    Effect.gen(function* () {
      const next = yield* update
      const session = Option.getOrUndefined(yield* Ref.get(attached))
      const previous = Option.getOrUndefined(yield* Ref.getAndSet(current, Option.some(next)))
      const all = yield* Ref.get(instances)
      if (JSON.stringify(previous) !== JSON.stringify(next))
        yield* Effect.forEach(all, (instance) => instance.reload, { discard: true })
      const api = all.at(0)?.session
      const info =
        session && api && Option.getOrUndefined(yield* api.get({ sessionID: session.sessionId }).pipe(Effect.option))
      if (!session || !api || !info) return next
      if (info.agent !== next.primary.name)
        yield* api
          .switchAgent({ sessionID: session.sessionId, agent: Agent.ID.make(next.primary.name) })
          .pipe(Effect.orDie)
      if (!sameModel(info.model, next.primary.model))
        yield* api.switchModel({ sessionID: session.sessionId, model: modelRef(next.primary.model) }).pipe(Effect.orDie)
      return next
    })
  return {
    current,
    attached,
    instances,
    control: {
      configure: (session) =>
        changes.withPermit(
          Ref.set(attached, Option.some(session)).pipe(Effect.andThen(apply(brain.setModel(session.model)))),
        ),
      pull: changes.withPermit(apply(brain.pull)),
      setModel: (model) => changes.withPermit(apply(brain.setModel(model))),
    },
  } satisfies Shared
})

export const make = (
  endpoints: Ref.Ref<ReadonlyArray<Models.Endpoint>>,
  reloads: Ref.Ref<ReadonlyArray<Effect.Effect<void>>>,
  loaded: Deferred.Deferred<void>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  settings: Option.Option<Shared>,
) =>
  Plugin.define({
    id: "ren",
    effect: (context) =>
      Effect.gen(function* () {
        const tool = context.tool
        const integration = context.integration
        const provider = context.provider
        if (Option.isNone(connections))
          yield* tool.transform((editor) => {
            for (const id of environmentTools) editor.remove(id)
          })
        if (Option.isSome(connections))
          yield* tool.hook("execute.after", (event) =>
            Effect.sync(() => {
              if (event.status !== "error") return
              const failure = environmentFailure(event.error.error)
              if (!failure || event.error.message.includes(failure.message)) return
              event.error = new Tool.Error({
                message: `${event.error.message}: ${failure.message}`,
                ...(Predicate.isNotUndefined(event.error.error) && { error: event.error.error }),
                ...(event.error.metadata && { metadata: event.error.metadata }),
              })
            }),
          )
        if (Option.isSome(connections))
          yield* context.event.subscribe().pipe(
            Stream.runForEach((event) => {
              if (event.type !== "session.idle" || !event.location?.workspaceID) return Effect.void
              const sessionId = RenWorkspaceDriver.sessionIdOf(event.location.workspaceID)
              if (Session.ID.make(event.data.sessionID) !== sessionId) return Effect.void
              return connections.value.release(sessionId)
            }),
            Effect.forkScoped,
          )
        yield* provider.transform((editor) => ModelProviders.apply(editor, Ref.getUnsafe(endpoints)))
        yield* integration.transform((editor) => {
          for (const integrationID of Ref.getUnsafe(endpoints).map((endpoint) => endpoint.id))
            editor.method.update({
              integrationID,
              method: { id: method, type: "oauth", label: "Ren" },
              authorize: () =>
                new ManagedKeyError({ message: "Ren issues this credential; it cannot be signed in to" }),
              refresh: (credential) => refresh(integrationID, credential, refreshKey),
            })
        })
        if (Option.isSome(settings)) {
          const shared = settings.value
          const agentOf = (name: string | undefined) =>
            Option.flatMap(Ref.getUnsafe(shared.current), (resolved) =>
              Option.fromUndefinedOr(
                !name || name === resolved.primary.name
                  ? resolved.primary
                  : resolved.subagents.find((agent) => agent.name === name),
              ),
            )
          yield* context.agent.transform((editor) => {
            const resolved = Option.getOrUndefined(Ref.getUnsafe(shared.current))
            if (!resolved) return
            for (const agent of editor.list()) if (!agent.hidden) editor.remove(agent.id)
            for (const agent of [resolved.primary, ...resolved.subagents])
              editor.update(agent.name, (info) => {
                info.mode = agent === resolved.primary ? "primary" : "subagent"
                info.model = modelRef(agent.model)
                if (agent.description) info.description = agent.description
              })
            editor.default(resolved.primary.name)
          })
          yield* context.reference.transform((editor) => {
            for (const reference of Option.getOrUndefined(Ref.getUnsafe(shared.current))?.references ?? [])
              editor.add(reference.alias, {
                type: "git",
                repository: reference.repository,
                ...(reference.branch && { branch: reference.branch }),
                ...(reference.description && { description: reference.description }),
              })
          })
          yield* context.session.hook("context", (event) =>
            Effect.sync(() => {
              const agent = Option.getOrUndefined(agentOf(event.agent))
              if (!agent) return
              event.system.push(...agent.instructions.map((text) => ({ type: "text" as const, text })))
              const hidden = new Set(BrainSettings.hiddenTools(agent, [], Object.keys(event.tools)))
              event.tools = Record.filter(event.tools, (_, name) => !hidden.has(name))
              const subagent = event.tools.subagent
              if (subagent && Predicate.isObject(subagent.input) && Predicate.isObject(subagent.input.properties))
                subagent.input = { ...subagent.input, properties: withoutModel(subagent.input.properties) }
            }),
          )
          yield* tool.hook("execute.before", (event) =>
            Effect.sync(() => {
              if (event.tool === "subagent") event.input = withoutModel(event.input)
            }),
          )
          yield* context.permission.hook("evaluate", (event) =>
            Effect.sync(() => {
              const agent = Option.getOrUndefined(agentOf(event.agent))
              if (!agent) return
              const decision = BrainSettings.evaluate(
                agent,
                { action: event.action, resources: event.resources },
                {
                  interactive: Option.match(Ref.getUnsafe(shared.attached), {
                    onNone: () => true,
                    onSome: (session) => session.interactive,
                  }),
                  denied: [],
                },
              )
              if (rank[decision.effect] <= rank[event.effect]) return
              event.effect = decision.effect
              if (decision.message) event.message = decision.message
            }),
          )
          yield* context.session.hook("prompt", (event) =>
            Effect.gen(function* () {
              const session = Option.getOrUndefined(yield* Ref.get(shared.attached))
              if (session?.sessionId !== event.sessionID) return
              yield* shared.control.pull.pipe(
                Effect.catch((error) => Effect.logWarning(`Kept the last settings: ${error.message}`)),
                Effect.asVoid,
              )
            }),
          )
          const instance = {
            reload: Effect.all([context.agent.reload(), context.reference.reload()], { discard: true }),
            session: context.session,
          }
          yield* Ref.update(shared.instances, (all) => [...all, instance])
          yield* Effect.addFinalizer(() =>
            Ref.update(shared.instances, (all) => all.filter((each) => each !== instance)),
          )
        }
        const reload = Effect.andThen(integration.reload(), provider.reload())
        yield* Ref.update(reloads, (all) => [...all, reload])
        yield* Effect.addFinalizer(() => Ref.update(reloads, (all) => all.filter((each) => each !== reload)))
        yield* Deferred.succeed(loaded, undefined)
      }),
  })
