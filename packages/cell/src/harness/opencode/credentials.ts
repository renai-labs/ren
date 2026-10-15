export * as Credentials from "./credentials.js"

import type { OpenCodeClient } from "@opencode/client/effect"
import { Credential } from "@opencode/core/credential"
import { IntegrationID } from "@opencode/schema/integration-id"
import type { Models } from "@ren/schema/models"
import { DateTime, Effect, Schema } from "effect"
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
  endpoints: ReadonlyArray<Models.Endpoint>,
) => Effect.Effect<void> = Effect.fn("Credentials.apply")(function* (client, store, endpoints) {
  const integrations = new Set((yield* client.integration.list().pipe(Effect.orDie)).data.map((item) => item.id))
  const wanted = new Set(endpoints.map((endpoint) => endpoint.id))
  const stored = new Map(
    (yield* store.all())
      .filter((credential) => credential.id.startsWith(owned))
      .map((credential) => [credential.integrationID, credential]),
  )
  yield* Effect.forEach(
    endpoints.filter((endpoint) => integrations.has(IntegrationID.make(endpoint.id))),
    (endpoint) => {
      const integrationID = IntegrationID.make(endpoint.id)
      const apiKey = endpoint.apiKey
      const value: Credential.Value = apiKey.expiresAt
        ? {
            type: "oauth",
            methodID: RenPlugin.method,
            access: apiKey.key,
            refresh: "",
            expires: DateTime.toEpochMillis(apiKey.expiresAt),
          }
        : { type: "key", key: apiKey.key }
      const current = stored.get(integrationID)
      if (!current)
        return store.create({ id: Credential.ID.make(`${owned}${endpoint.id}`), integrationID, value, label: "Ren" })
      return replaces(current.value, value) ? store.update(current.id, { value }) : Effect.void
    },
    { discard: true },
  )
  yield* Effect.forEach(
    [...stored.values()].filter((credential) => !wanted.has(credential.integrationID)),
    (credential) => store.remove(credential.id),
    { discard: true },
  )
})
