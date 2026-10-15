export * as RenPlugin from "./plugin.js"

import { Plugin } from "@opencode/plugin/effect"
import type { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Clock, DateTime, Effect, Option, Schema, Struct } from "effect"
import type { Harness } from "../harness.js"

const unavailable = ["read", "write", "edit", "patch", "glob", "grep", "shell"]

export const method = IntegrationMethodID.make("ren")

export class ManagedKeyError extends Schema.TaggedError<ManagedKeyError>()("ManagedKeyError", {
  message: Schema.String,
}) {}

export const refresh = Effect.fn("RenPlugin.refresh")(function* (
  providerId: string,
  credential: Credential.OAuth,
  renew: Harness.Renew,
) {
  const renewed = yield* renew(providerId, credential.expires)
  const expiresAt = Option.flatMap(renewed, (apiKey) => Option.fromNullishOr(apiKey.expiresAt))
  if (Option.isSome(renewed) && Option.isSome(expiresAt))
    return Struct.evolve(credential, {
      access: () => renewed.value.key,
      expires: () => DateTime.toEpochMillis(expiresAt.value),
    })
  if ((yield* Clock.currentTimeMillis) < credential.expires) return credential
  return yield* new ManagedKeyError({
    message: `The model key for provider ${providerId} expired at ${new Date(credential.expires).toISOString()}`,
  })
})

export const make = (configured: ReadonlyArray<string>, renew: Harness.Renew) =>
  Plugin.define({
    id: "ren",
    effect: (context) =>
      Effect.gen(function* () {
        const tool = context.tool
        const integration = context.integration
        yield* tool.transform((editor) => {
          for (const id of unavailable) editor.remove(id)
        })
        // oxlint-disable-next-line ren/no-comments -- Config providers are registered after SDK transforms, so include their ids explicitly.
        yield* integration.transform((editor) => {
          for (const integrationID of new Set([...editor.list().map((item) => item.id), ...configured]))
            editor.method.update({
              integrationID,
              method: { id: method, type: "oauth", label: "Ren" },
              authorize: () =>
                new ManagedKeyError({ message: "Ren issues this credential; it cannot be signed in to" }),
              refresh: (credential) => refresh(integrationID, credential, renew),
            })
        })
      }),
  })
