export * as RenPlugin from "./plugin.js"

import { Message } from "@opencode/ai/schema/messages"
import { Plugin } from "@opencode/plugin/effect"
import type { Credential } from "@opencode/schema/credential"
import { Agent, Model, Provider } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import { Tool } from "@opencode/schema/tool"
import { Wildcard } from "@opencode/core/util/wildcard"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { BrainSettings } from "@ren/brain/settings"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import {
  Clock,
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
import { ModelCredentials } from "./model-credentials.js"
import { ModelProviders } from "./model-providers.js"
import { basename } from "node:path"
import { RenWorkspaceDriver } from "./workspace-driver.js"

const environmentTools = ["read", "write", "edit", "patch", "glob", "grep", "shell"]

export class ManagedKeyError extends Schema.TaggedError<ManagedKeyError>()("ManagedKeyError", {
  message: Schema.String,
}) {}

const never = Number.MAX_SAFE_INTEGER

const rank = { allow: 0, ask: 1, deny: 2 } as const

export type Chat = BrainSettings.Chat

interface Instance {
  readonly reload: Effect.Effect<void>
  readonly session: Plugin.Context["session"]
  readonly installed: Ref.Ref<Option.Option<Chat>>
}

// oxlint-disable-next-line ren/no-comments -- The model list one Location installed (E64). A new list waits for the Location's running turns to end.
export interface LocationModels {
  readonly installed: Ref.Ref<ReadonlyArray<Models.Endpoint>>
  readonly offer: Effect.Effect<void>
}

// oxlint-disable-next-line ren/no-comments -- OpenCode 2 ends a turn with an execution event and does not publish session.idle.
const turnEnded = (event: { readonly type: string; readonly data: unknown }) =>
  event.type === "session.execution.succeeded" ||
  event.type === "session.execution.failed" ||
  event.type === "session.execution.interrupted"
    ? Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Struct({ sessionID: Schema.String }))(event.data))
        ?.sessionID
    : undefined

export interface Confinement {
  readonly workspace: string
  readonly allow: ReadonlyArray<string>
}

export interface Chats {
  readonly latest: Ref.Ref<ReadonlyMap<string, Chat>>
  readonly instances: Ref.Ref<ReadonlyMap<string, Instance>>
  readonly turnEnded: Ref.Ref<(sessionId: string) => Effect.Effect<void>>
  readonly turnStarted: Ref.Ref<(sessionId: string) => Effect.Effect<void>>
  readonly install: (sessionId: string) => Effect.Effect<void>
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

const decodeSpeaker = Schema.decodeUnknownOption(
  Schema.Struct({ userID: Schema.String, userName: Schema.optionalKey(Schema.String) }),
)

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
  if (Option.isNone(refreshed))
    return yield* new ManagedKeyError({
      message: `The model key for endpoint ${endpointId} expired, and Ren gave no new key`,
    })
  const now = yield* Clock.currentTimeMillis
  const expiresAt = refreshed.value.expiresAt
  return Struct.evolve(credential, {
    access: () => Redacted.value(refreshed.value.key),
    expires: () => (expiresAt ? ModelCredentials.renewAt(expiresAt, now) : never),
  })
})

export const chats = Effect.fnUntraced(function* (saved: ReadonlyMap<string, Chat>) {
  const latest = yield* Ref.make<ReadonlyMap<string, Chat>>(saved)
  const instances = yield* Ref.make<ReadonlyMap<string, Instance>>(new Map())
  const turnEnded = yield* Ref.make<(sessionId: string) => Effect.Effect<void>>(() => Effect.void)
  const turnStarted = yield* Ref.make<(sessionId: string) => Effect.Effect<void>>(() => Effect.void)
  const installs = yield* Semaphore.make(1)
  return {
    latest,
    instances,
    turnEnded,
    turnStarted,
    install: (sessionId) =>
      installs.withPermit(
        Effect.gen(function* () {
          const next = (yield* Ref.get(latest)).get(sessionId)
          const instance = (yield* Ref.get(instances)).get(sessionId)
          if (!next || !instance) return
          const previous = Option.getOrUndefined(yield* Ref.getAndSet(instance.installed, Option.some(next)))
          if (JSON.stringify(previous?.resolved) !== JSON.stringify(next.resolved)) yield* instance.reload
          const sessionID = SessionID.make(sessionId)
          const info = Option.getOrUndefined(yield* instance.session.get({ sessionID }).pipe(Effect.option))
          if (!info) return
          if (info.agent !== next.resolved.primary.name)
            yield* instance.session
              .switchAgent({ sessionID, agent: Agent.ID.make(next.resolved.primary.name) })
              .pipe(Effect.orDie)
          if (!sameModel(info.model, next.resolved.primary.model))
            yield* instance.session
              .switchModel({ sessionID, model: modelRef(next.resolved.primary.model) })
              .pipe(Effect.orDie)
        }),
      ),
  } satisfies Chats
})

export const make = (
  endpoints: Ref.Ref<ReadonlyArray<Models.Endpoint>>,
  locations: Ref.Ref<ReadonlyArray<LocationModels>>,
  synced: Effect.Effect<void>,
  renew: (endpointId: string) => Effect.Effect<boolean>,
  loaded: Deferred.Deferred<void>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<EnvironmentConnections.Interface>,
  settings: Option.Option<Chats>,
  confinement: Option.Option<Confinement>,
  approvals: (
    sessionId: string,
  ) => Effect.Effect<ReadonlyArray<{ readonly action: string; readonly resource: string }>, Harness.NotFound>,
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
        const folder = context.location.directory
        if (Option.isSome(confinement) && folder.startsWith(`${confinement.value.workspace}/`)) {
          const allow = confinement.value.allow
          yield* context.permission.hook("evaluate", (event) =>
            Effect.sync(() => {
              if (event.action !== "external_directory" || event.effect === "deny") return
              if (event.resources.every((resource) => allow.some((prefix) => resource.startsWith(prefix)))) {
                event.effect = "allow"
                return
              }
              event.effect = "deny"
              event.message = `This chat works only in its own folder, ${folder}, and in ${allow.join(", ")}`
            }),
          )
        }
        const turns = { running: new Set<string>(), ended: [] as Array<(sessionID: string) => Effect.Effect<void>> }
        const workspaceID = context.location.workspaceID
        if (Option.isSome(connections) && workspaceID) {
          const own = RenWorkspaceDriver.sessionIdOf(workspaceID)
          turns.ended.push((sessionID) =>
            Session.ID.make(sessionID) === own ? connections.value.release(own) : Effect.void,
          )
        }
        yield* context.session.hook("context", (event) =>
          Effect.sync(() => {
            const speakers = event.messages.map((message) =>
              message.role === "user" ? Option.getOrUndefined(decodeSpeaker(message.metadata)) : undefined,
            )
            event.messages = event.messages.map((message, index) => {
              const speaker = speakers[index]
              const previous = speakers.slice(0, index).findLast(Predicate.isNotUndefined)
              if (!speaker || !previous || previous.userID === speaker.userID) return message
              const user = speaker.userName ? `user=${JSON.stringify(speaker.userName)} ` : ""
              return Message.make({
                ...Struct.omit(message, ["content"]),
                content: [
                  ...message.content,
                  Message.text(`\n\n<message_from ${user}user_id=${JSON.stringify(speaker.userID)} />`),
                ],
              })
            })
          }),
        )
        const models = yield* Ref.make(yield* Ref.get(endpoints))
        yield* provider.transform((editor) => ModelProviders.apply(editor, Ref.getUnsafe(models)))
        yield* integration.transform((editor) => {
          for (const integrationID of Ref.getUnsafe(models).map((endpoint) => endpoint.id))
            editor.method.update({
              integrationID,
              method: { id: ModelCredentials.method, type: "oauth", label: "Ren" },
              authorize: () =>
                new ManagedKeyError({ message: "Ren issues this credential; it cannot be signed in to" }),
              refresh: (credential) => refresh(integrationID, credential, refreshKey),
            })
        })
        if (Option.isSome(settings)) {
          const shared = settings.value
          const directory = context.location.directory
          const sessionId = context.location.workspaceID
            ? RenWorkspaceDriver.sessionIdOf(context.location.workspaceID)
            : basename(directory)
          const saved = (yield* Ref.get(shared.latest)).get(sessionId)
          const installed = yield* Ref.make(Option.fromUndefinedOr(saved))
          const agentOf = (name: string | undefined) =>
            Option.flatMap(Ref.getUnsafe(installed), (chat) =>
              Option.fromUndefinedOr(
                !name || name === chat.resolved.primary.name
                  ? chat.resolved.primary
                  : chat.resolved.subagents.find((agent) => agent.name === name),
              ),
            )
          yield* context.agent.transform((editor) => {
            const resolved = Option.getOrUndefined(Ref.getUnsafe(installed))?.resolved
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
            for (const reference of Option.getOrUndefined(Ref.getUnsafe(installed))?.resolved.references ?? [])
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
            Effect.gen(function* () {
              const agent = Option.getOrUndefined(agentOf(event.agent))
              if (!agent) return
              const decision = BrainSettings.evaluate(
                agent,
                { action: event.action, resources: event.resources },
                {
                  interactive: Option.match(Ref.getUnsafe(installed), {
                    onNone: () => true,
                    onSome: (chat) => chat.interactive,
                  }),
                  denied: [],
                },
              )
              if (rank[decision.effect] <= rank[event.effect]) return
              if (decision.effect === "ask") {
                const saved = yield* approvals(event.sessionID).pipe(
                  Effect.catchTag("Harness.NotFound", () => Effect.succeed([])),
                )
                if (
                  event.resources.every((resource) =>
                    saved.some(
                      (item) => Wildcard.match(event.action, item.action) && Wildcard.match(resource, item.resource),
                    ),
                  )
                )
                  return
              }
              event.effect = decision.effect
              if (decision.message) event.message = decision.message
            }),
          )
          yield* context.session.hook("prompt", (event) =>
            Effect.flatMap(Ref.get(shared.turnStarted), (started) => started(event.sessionID)),
          )
          turns.ended.push((sessionID) => Effect.flatMap(Ref.get(shared.turnEnded), (ended) => ended(sessionID)))
          const instance = {
            reload: Effect.all([context.agent.reload(), context.reference.reload()], { discard: true }),
            session: context.session,
            installed,
          }
          yield* Ref.update(shared.instances, (all) => new Map([...all, [sessionId, instance]]))
          yield* Effect.addFinalizer(() =>
            Ref.update(shared.instances, (all) => new Map([...all].filter((entry) => entry.at(1) !== instance))),
          )
        }
        yield* context.session.hook("retry", (event) =>
          Effect.gen(function* () {
            if (event.error.status !== 401 || event.attempt !== 2) return
            if (!Ref.getUnsafe(models).some((endpoint) => endpoint.id === event.model.providerID)) return
            if (yield* renew(event.model.providerID)) event.decision = { retry: true, delay: 0 }
          }),
        )
        const catalog = { waiting: false }
        const install = Ref.get(endpoints).pipe(
          Effect.flatMap((latest) => Ref.set(models, latest)),
          Effect.andThen(integration.reload()),
          Effect.andThen(provider.reload()),
          Effect.andThen(synced),
        )
        turns.ended.push(() => {
          if (turns.running.size > 0 || !catalog.waiting) return Effect.void
          catalog.waiting = false
          return install
        })
        yield* context.session.hook("prompt", (event) => Effect.sync(() => void turns.running.add(event.sessionID)))
        yield* context.event.subscribe().pipe(
          Stream.runForEach((event) => {
            const sessionID = turnEnded(event)
            if (!sessionID || !turns.running.delete(sessionID)) return Effect.void
            return Effect.forEach(turns.ended, (each) => each(sessionID), { discard: true })
          }),
          Effect.forkScoped,
        )
        const location: LocationModels = {
          installed: models,
          offer: Effect.suspend(() => {
            if (turns.running.size === 0) return install
            catalog.waiting = true
            return Effect.void
          }),
        }
        yield* Ref.update(locations, (all) => [...all, location])
        yield* Effect.addFinalizer(() => Ref.update(locations, (all) => all.filter((each) => each !== location)))
        yield* Deferred.succeed(loaded, undefined)
      }),
  })
