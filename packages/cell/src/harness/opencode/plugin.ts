export * as RenPlugin from "./plugin.js"

import { Plugin } from "@opencode/plugin/effect"
import type { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import type { Models } from "@ren/schema/models"
import { Clock, DateTime, Effect, Option, Redacted, Ref, Schema, Struct } from "effect"
import type { Harness } from "../harness.js"
import { ModelProviders } from "./model-providers.js"

const unavailable = ["read", "write", "edit", "patch", "glob", "grep", "shell"]

export const method = IntegrationMethodID.make("ren")

export class ManagedKeyError extends Schema.TaggedError<ManagedKeyError>()("ManagedKeyError", {
  message: Schema.String,
}) {}

const never = Number.MAX_SAFE_INTEGER

export const refresh = Effect.fn("RenPlugin.refresh")(function* (
  endpointId: string,
  credential: Credential.OAuth,
  renew: Harness.Renew,
) {
  const renewed = yield* renew(endpointId, credential.expires)
  if (Option.isSome(renewed))
    return Struct.evolve(credential, {
      access: () => Redacted.value(renewed.value.key),
      expires: () => (renewed.value.expiresAt ? DateTime.toEpochMillis(renewed.value.expiresAt) : never),
    })
  if ((yield* Clock.currentTimeMillis) < credential.expires) return credential
  return yield* new ManagedKeyError({
    message: `The model key for endpoint ${endpointId} expired at ${new Date(credential.expires).toISOString()}`,
  })
})

export const make = (
  endpoints: Ref.Ref<ReadonlyArray<Models.Endpoint>>,
  reload: Ref.Ref<Effect.Effect<void>>,
  renew: Harness.Renew,
) =>
  Plugin.define({
    id: "ren",
    effect: (context) =>
      Effect.gen(function* () {
        const tool = context.tool
        const integration = context.integration
        const provider = context.provider
        yield* tool.transform((editor) => {
          for (const id of unavailable) editor.remove(id)
        })
        yield* provider.transform((editor) => ModelProviders.apply(editor, Ref.getUnsafe(endpoints)))
        yield* integration.transform((editor) => {
          for (const integrationID of Ref.getUnsafe(endpoints).map((endpoint) => endpoint.id))
            editor.method.update({
              integrationID,
              method: { id: method, type: "oauth", label: "Ren" },
              authorize: () =>
                new ManagedKeyError({ message: "Ren issues this credential; it cannot be signed in to" }),
              refresh: (credential) => refresh(integrationID, credential, renew),
            })
        })
        yield* Ref.set(reload, Effect.andThen(integration.reload(), provider.reload()))
      }),
  })
