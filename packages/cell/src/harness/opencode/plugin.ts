export * as RenPlugin from "./plugin.js"

import { Plugin } from "@opencode/plugin/effect"
import type { Credential } from "@opencode/schema/credential"
import { Session } from "@ren/schema/session"
import { Clock, Effect, Schema } from "effect"

const unavailable = ["read", "write", "edit", "patch", "glob", "grep", "shell"]

export class ManagedKeyError extends Schema.TaggedError<ManagedKeyError>()("ManagedKeyError", {
  message: Schema.String,
}) {}

export const refresh = Effect.fn("RenPlugin.refresh")(function* (providerId: string, credential: Credential.OAuth) {
  if ((yield* Clock.currentTimeMillis) < credential.expires) return credential
  return yield* new ManagedKeyError({
    message: `The model key for provider ${providerId} expired at ${new Date(credential.expires).toISOString()}`,
  })
})

export const make = (configured: ReadonlyArray<string>) =>
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
              method: { id: Session.ManagedMethod, type: "oauth", label: "Ren" },
              authorize: () =>
                new ManagedKeyError({ message: "Ren issues this credential; it cannot be signed in to" }),
              refresh: (credential) => refresh(integrationID, credential),
            })
        })
      }),
  })
