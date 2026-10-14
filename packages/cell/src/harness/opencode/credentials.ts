export * as Credentials from "./credentials.js"

import type { OpenCodeClient } from "@opencode/client/effect"
import { Credential } from "@opencode/core/credential"
import { IntegrationID } from "@opencode/schema/integration-id"
import { BrainRejectedError } from "@ren/brain-api/errors"
import type { Session } from "@ren/schema/session"
import { Effect, Schema } from "effect"
import { RenPlugin } from "./plugin.js"

const owned = "cred_ren_"

const same = Schema.toEquivalence(Credential.Value)

export const replaces = (stored: Credential.Value, next: Credential.Value) => {
  if (stored.type === "oauth" && next.type === "oauth")
    return stored.methodID !== next.methodID || next.expires > stored.expires
  return !same(stored, next)
}

export const apply: (
  client: OpenCodeClient,
  store: Credential.Interface,
  wanted: Session.Credentials,
  mode: "replace" | "merge",
) => Effect.Effect<void, BrainRejectedError> = Effect.fn("Credentials.apply")(function* (client, store, wanted, mode) {
  const integrations = new Set((yield* client.integration.list().pipe(Effect.orDie)).data.map((item) => item.id))
  const unknown = Object.keys(wanted).filter((providerId) => !integrations.has(IntegrationID.make(providerId)))
  if (unknown.length > 0)
    return yield* new BrainRejectedError({ message: `Unknown provider: ${unknown.toSorted().join(", ")}` })
  const stored = new Map(
    (yield* store.all())
      .filter((credential) => credential.id.startsWith(owned))
      .map((credential) => [credential.integrationID, credential]),
  )
  yield* Effect.forEach(
    Object.entries(wanted),
    ([providerId, credential]) => {
      const integrationID = IntegrationID.make(providerId)
      const value: Credential.Value =
        credential.type === "key"
          ? {
              type: "key",
              key: credential.key,
              ...(credential.configuration && { configuration: credential.configuration }),
            }
          : {
              type: "oauth",
              methodID: RenPlugin.method,
              access: credential.key,
              refresh: "",
              expires: credential.expires,
            }
      const current = stored.get(integrationID)
      if (!current)
        return store.create({ id: Credential.ID.make(`${owned}${providerId}`), integrationID, value, label: "Ren" })
      return replaces(current.value, value) ? store.update(current.id, { value }) : Effect.void
    },
    { discard: true },
  )
  if (mode === "merge") return
  yield* Effect.forEach(
    [...stored.values()].filter((credential) => !Object.hasOwn(wanted, credential.integrationID)),
    (credential) => store.remove(credential.id),
    { discard: true },
  )
})
