export * as Shared from "./shared.js"

import { Celld } from "./celld.js"
import { StubModel } from "./stub-model.js"
import { TestToken } from "./token.js"
import { Wrangler } from "./wrangler.js"
import type { Models } from "@ren/schema/models"
import { Context, DateTime, Effect, Layer } from "effect"

export class Service extends Context.Service<Service, Celld.Instance>()("@ren/cell/test/Shared") {}

export const layer = Layer.effect(
  Service,
  Effect.acquireRelease(
    Effect.promise(() =>
      process.env.CELL_RUNTIME === "wrangler" ? Wrangler.make(vars(stub().url)) : Celld.make(vars()),
    ),
    (instance) => Effect.promise(instance.dispose),
  ),
)

const state: { stub: StubModel.Server | undefined } = {
  stub: undefined,
}

export const stub = () => (state.stub ??= StubModel.start())

export const vars = (baseURL = stub().cellUrl) => ({
  ...TestToken.vars,
  ALARM_INTERVAL_MS: "1000",
  WAIT_BUDGET_MS: "3000",
  PARK_AFTER_MS: "2000",
  OPENCODE_CONFIG: JSON.stringify({
    model: "stub/stub-model",
    providers: {
      stub: {
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL, apiKey: "stub-key" },
        models: {
          "stub-model": { name: "Stub", limit: { context: 100_000, output: 4000 }, variants: [{ id: "high" }] },
          "stub-other": { name: "Stub Other", limit: { context: 100_000, output: 4000 } },
        },
      },
      anthropic: {
        package: "@ai-sdk/anthropic",
        settings: { baseURL },
        models: { "stub-claude": { name: "Stub Claude", limit: { context: 100_000, output: 4000 } } },
      },
    },
  }),
})

const limit = { context: 100_000, output: 4000 }

const endpoints: Readonly<Record<string, Pick<Models.Endpoint, "protocol" | "models">>> = {
  stub: {
    protocol: "openai-chat",
    models: [
      { id: "stub-model", name: "Stub", limit },
      { id: "stub-other", name: "Stub Other", limit },
    ],
  },
  anthropic: { protocol: "anthropic-messages", models: [{ id: "stub-claude", name: "Stub Claude", limit }] },
}

export const apiKey = (key: string, expiresAtMs?: number): Models.ApiKey => ({
  key,
  ...(expiresAtMs !== undefined && { expiresAt: DateTime.makeUnsafe(expiresAtMs) }),
})

export const access = (
  apiKeys: Readonly<Record<string, Models.ApiKey>> = { stub: apiKey("stub-key") },
  baseUrl = stub().cellUrl,
): Models.Access => ({
  endpoints: Object.entries(apiKeys).map((entry) => ({
    id: entry[0],
    protocol: endpoints[entry[0]]?.protocol ?? "openai-chat",
    baseUrl,
    apiKey: entry[1],
    models: endpoints[entry[0]]?.models ?? [{ id: "stub-model", name: "Stub", limit }],
  })),
})

export const dispose = async () => {
  await state.stub?.stop()
}
