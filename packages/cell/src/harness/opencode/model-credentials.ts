export * as ModelCredentials from "./model-credentials.js"

import { IntegrationID } from "@opencode/schema/integration-id"
import type { Models } from "@ren/schema/models"
import { DateTime, Redacted } from "effect"
import type { Credentials } from "./credentials.js"
import { RenPlugin } from "./plugin.js"

export const owner = "model"

export const entries = (endpoints: ReadonlyArray<Models.Endpoint>): ReadonlyArray<Credentials.Entry> =>
  endpoints.map((endpoint) => ({
    integrationID: IntegrationID.make(endpoint.id),
    value: endpoint.apiKey.expiresAt
      ? {
          type: "oauth",
          methodID: RenPlugin.method,
          access: Redacted.value(endpoint.apiKey.key),
          refresh: "",
          expires: DateTime.toEpochMillis(endpoint.apiKey.expiresAt),
        }
      : { type: "key", key: Redacted.value(endpoint.apiKey.key) },
  }))
