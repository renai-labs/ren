export * as Credentials from "./credentials.js"

import { Credential } from "@opencode/core/credential"
import type { IntegrationID } from "@opencode/schema/integration-id"
import { Effect, Schema } from "effect"

export interface Entry {
  readonly integrationID: IntegrationID
  readonly value: Credential.Value
}

const same = Schema.toEquivalence(Credential.Value)

export const replaces = (stored: Credential.Value, next: Credential.Value) => {
  if (stored.type === "oauth" && next.type === "oauth")
    return stored.methodID !== next.methodID || stored.access !== next.access || next.expires > stored.expires
  return !same(stored, next)
}

export const sync = Effect.fn("Credentials.sync")(function* (
  store: Credential.Interface,
  owner: string,
  entries: ReadonlyArray<Entry>,
) {
  const prefix = `cred_ren_${owner}_`
  const wanted = new Set(entries.map((entry) => entry.integrationID))
  const stored = new Map(
    (yield* store.all())
      .filter((credential) => credential.id.startsWith(prefix))
      .map((credential) => [credential.integrationID, credential]),
  )
  yield* Effect.forEach(
    entries,
    (entry) => {
      const current = stored.get(entry.integrationID)
      if (!current)
        return store.create({
          id: Credential.ID.make(`${prefix}${entry.integrationID}`),
          integrationID: entry.integrationID,
          value: entry.value,
          label: "Ren",
        })
      return replaces(current.value, entry.value) ? store.update(current.id, { value: entry.value }) : Effect.void
    },
    { discard: true },
  )
  yield* Effect.forEach(
    [...stored.values()].filter((credential) => !wanted.has(credential.integrationID)),
    (credential) => store.remove(credential.id),
    { discard: true },
  )
})
