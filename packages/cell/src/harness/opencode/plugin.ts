export * as RenPlugin from "./plugin.js"

import { Plugin } from "@opencode/plugin/effect"
import type { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Tool } from "@opencode/schema/tool"
import { ExecutorClient } from "@ren/hand-api/executor-client"
import { HandConnections } from "@ren/brain/hand-connections"
import { Identifier } from "@ren/schema/identifier"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Clock, DateTime, Deferred, Effect, Option, Predicate, Redacted, Ref, Schema, Stream, Struct } from "effect"
import type { Harness } from "../harness.js"
import { ModelProviders } from "./model-providers.js"

const unavailable = ["read", "write", "edit", "patch", "glob", "grep", "shell"]

export const method = IntegrationMethodID.make("ren")

export class ManagedKeyError extends Schema.TaggedError<ManagedKeyError>()("ManagedKeyError", {
  message: Schema.String,
}) {}

const never = Number.MAX_SAFE_INTEGER

const handFailure = (value: unknown, depth = 0): { readonly message: string } | undefined => {
  if (value instanceof HandConnections.Unavailable) return value
  if (ExecutorClient.isNoAnswer(value) && value instanceof Error)
    return { message: `The hand does not answer: ${value.message}` }
  if (depth > 8 || !Predicate.isObject(value)) return undefined
  return ["cause", "error", "reason"]
    .map((key) => (Predicate.hasProperty(value, key) ? handFailure(value[key], depth + 1) : undefined))
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

export const make = (
  endpoints: Ref.Ref<ReadonlyArray<Models.Endpoint>>,
  reloads: Ref.Ref<ReadonlyArray<Effect.Effect<void>>>,
  loaded: Deferred.Deferred<void>,
  refreshKey: Harness.Refresh,
  connections: Option.Option<HandConnections.Interface>,
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
            for (const id of unavailable) editor.remove(id)
          })
        if (Option.isSome(connections))
          yield* tool.hook("execute.after", (event) =>
            Effect.sync(() => {
              if (event.status !== "error") return
              const failure = handFailure(event.error.error)
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
              if (Identifier.suffix(event.data.sessionID) !== Identifier.suffix(event.location.workspaceID))
                return Effect.void
              return connections.value.release(Session.ID.make(event.data.sessionID))
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
        const reload = Effect.andThen(integration.reload(), provider.reload())
        yield* Ref.update(reloads, (all) => [...all, reload])
        yield* Effect.addFinalizer(() => Ref.update(reloads, (all) => all.filter((each) => each !== reload)))
        yield* Deferred.succeed(loaded, undefined)
      }),
  })
