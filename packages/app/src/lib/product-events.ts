export * as ProductEvents from "./product-events.js"

import type { Platform } from "../platform/platform.js"

export const autocaptureUrls: ReadonlyArray<RegExp> = [
  /\/app\/marketplace(?:[/?#]|$)/u,
  /\/app\/settings\/(?:channels|credentials|providers)(?:[/?#]|$)/u,
  /\/app\/spaces\/[^/]+\/(?:apps|channels|credentials)(?:[/?#]|$)/u,
]

export type Integration =
  | { readonly kind: "app"; readonly integration: string }
  | { readonly kind: "channel"; readonly integration: "slack" | "linear" | "github" }
  | { readonly kind: "account"; readonly integration: "github" | "slack" }
  | { readonly kind: "model_provider"; readonly integration: "ren_inference" }

export type Entry = "marketplace" | "space_apps" | "composer" | "channels" | "credentials" | "providers"

export type Step = "profile_created" | "access_changed" | "provider_opened" | "key_saved" | "install_started"

export interface Events {
  readonly connect_started: { readonly entry: Entry }
  readonly connect_step: { readonly step: Step }
  readonly connect_failed: { readonly step: Step; readonly error: string }
  readonly connect_completed: {}
  readonly connect_abandoned: {}
}

export function make(platform: Platform.Info) {
  const key = (integration: Integration) => `connect.v1.${integration.kind}.${integration.integration}`
  const capture = <Name extends keyof Events>(
    integration: Integration,
    attempt: string,
    event: Name,
    properties: Events[Name],
  ) =>
    platform.analytics?.capture(event, {
      ...properties,
      kind: integration.kind,
      integration: integration.integration,
      attempt,
    })
  const during = <Name extends keyof Events>(
    integration: Integration,
    event: Name,
    properties: Events[Name],
    options: { readonly ends: boolean },
  ) => {
    const attempt = platform.storage.get(key(integration))
    if (attempt === undefined) return
    if (options.ends) platform.storage.remove(key(integration))
    capture(integration, attempt, event, properties)
  }
  return {
    started: (integration: Integration, entry: Entry) => {
      const attempt = crypto.randomUUID()
      platform.storage.set(key(integration), attempt)
      capture(integration, attempt, "connect_started", { entry })
    },
    step: (integration: Integration, step: Step) => during(integration, "connect_step", { step }, { ends: false }),
    failed: (integration: Integration, step: Step, error: string) =>
      during(integration, "connect_failed", { step, error }, { ends: false }),
    completed: (integration: Integration) => during(integration, "connect_completed", {}, { ends: true }),
    abandoned: (integration: Integration) => during(integration, "connect_abandoned", {}, { ends: true }),
  }
}
