export * as ModelCredentials from "./model-credentials.js"

import { IntegrationID, IntegrationMethodID } from "@opencode/schema/integration-id"
import type { Models } from "@ren/schema/models"
import { DateTime, Duration, Redacted } from "effect"
import { ModelRefresh } from "../../model-refresh.js"
import type { Credentials } from "./credentials.js"

export const owner = "model"

export const method = IntegrationMethodID.make("ren")

const opencodeMargin = Duration.minutes(5)

const retryAfter = Duration.minutes(1)

// oxlint-disable-next-line ren/no-comments -- OpenCode refreshes an OAuth credential 5 minutes before its expires. Ren gives OpenCode an earlier expires, so OpenCode asks for a new key at the start of the 3 hour refresh window.
const windowStart = (expiresAt: DateTime.Utc) => {
  const expires = DateTime.toEpochMillis(expiresAt)
  return Math.min(expires, expires - Duration.toMillis(ModelRefresh.window) + Duration.toMillis(opencodeMargin))
}

// oxlint-disable-next-line ren/no-comments -- After a refresh that kept a key in its window because Ren did not renew it, OpenCode asks again a minute later, until the key expires.
export const renewAt = (expiresAt: DateTime.Utc, now: number) =>
  Math.min(
    DateTime.toEpochMillis(expiresAt),
    Math.max(windowStart(expiresAt), now + Duration.toMillis(opencodeMargin) + Duration.toMillis(retryAfter)),
  )

export const entries = (endpoints: ReadonlyArray<Models.Endpoint>): ReadonlyArray<Credentials.Entry> =>
  endpoints.map((endpoint) => ({
    integrationID: IntegrationID.make(endpoint.id),
    value: endpoint.apiKey.expiresAt
      ? {
          type: "oauth",
          methodID: method,
          access: Redacted.value(endpoint.apiKey.key),
          refresh: "",
          expires: windowStart(endpoint.apiKey.expiresAt),
        }
      : { type: "key", key: Redacted.value(endpoint.apiKey.key) },
  }))
