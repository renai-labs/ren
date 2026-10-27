export * as Shared from "./shared.js"

import { BunBrain } from "./bun-brain.js"
import { Celld } from "./celld.js"
import { FakeRen } from "./ren.js"
import { StubModel } from "./stub-model.js"
import { TestToken } from "./token.js"
import { Wrangler } from "./wrangler.js"
import { Brain } from "@ren/schema/brain"
import type { Models } from "@ren/schema/models"
import { Context, DateTime, Effect, Layer, Option, Redacted, Schedule } from "effect"
import type { Harness } from "../../src/harness/harness.js"

export interface Runtime extends Celld.Instance {
  readonly kind: "bun" | "celld" | "wrangler"
  readonly ren: FakeRen.Instance
  readonly brain: () => Brain.ID
}

export class Service extends Context.Service<Service, Runtime>()("@ren/cell/test/Shared") {}

export const kind = (): Runtime["kind"] => {
  if (process.env.CELL_RUNTIME === "wrangler") return "wrangler"
  if (process.env.CELL_RUNTIME === "celld") return "celld"
  return "bun"
}

export const make = async (
  options: { readonly vars?: Readonly<Record<string, string>>; readonly worker?: string } = {},
): Promise<Runtime> => {
  const runtime = options.worker && kind() === "bun" ? "celld" : kind()
  const ren = FakeRen.start({ hostname: runtime === "celld" ? "0.0.0.0" : "127.0.0.1" })
  const local = runtime === "celld" ? stub().cellUrl : stub().url
  ren.models(access(undefined, local))
  const renUrl = runtime === "celld" ? ren.url.replace("127.0.0.1", "host.docker.internal") : ren.url
  const env = { ...vars(local), REN_URL: renUrl, ...options.vars }
  if (runtime === "bun") {
    const brain = Brain.ID.create()
    const instance = await BunBrain.make(env, { brain })
    return {
      ...instance,
      kind: runtime,
      ren,
      brain: () => brain,
      dispose: async () => {
        await instance.dispose()
        await ren.stop()
      },
    }
  }
  const instance =
    runtime === "wrangler" ? await Wrangler.make(env, options.worker) : await Celld.make(env, options.worker)
  return {
    ...instance,
    kind: runtime,
    ren,
    brain: () => Brain.ID.create(),
    dispose: async () => {
      await instance.dispose()
      await ren.stop()
    },
  }
}

export const layer = Layer.effect(
  Service,
  Effect.acquireRelease(
    Effect.promise(() => make()),
    (instance) => Effect.promise(instance.dispose),
  ),
)

const state: { stub: StubModel.Server | undefined } = {
  stub: undefined,
}

export const stub = () => (state.stub ??= StubModel.start())

export const vars = (baseURL = stub().cellUrl, models: Readonly<Record<string, unknown>> = {}) => ({
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
          ...models,
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
  key: Redacted.make(key),
  ...(expiresAtMs !== undefined && { expiresAt: DateTime.makeUnsafe(expiresAtMs) }),
})

export const access = (
  apiKeys: Readonly<Record<string, Models.ApiKey>> = { stub: apiKey("stub-key") },
  baseUrl = kind() === "celld" ? stub().cellUrl : stub().url,
): Models.Access => ({
  endpoints: Object.entries(apiKeys).map((entry) => ({
    id: entry[0],
    protocol: endpoints[entry[0]]?.protocol ?? "openai-chat",
    baseUrl,
    apiKey: entry[1],
    models: endpoints[entry[0]]?.models ?? [{ id: "stub-model", name: "Stub", limit }],
  })),
})

// oxlint-disable-next-line ren/no-comments -- Ren's inference URL for a test brain: the stub model serves /model/info with the models of `access`.
export const inference = (root = kind() === "celld" ? stub().cellRoot : stub().root) =>
  Effect.succeed(Option.some({ baseUrl: root }))

// oxlint-disable-next-line ren/no-comments -- A catalog change reloads OpenCode's servers in the background (HR19); a test that needs the new tools waits for that reload.
export const appsSettled = (instance: Pick<Harness.Instance, "configuration">) =>
  instance.configuration.pipe(
    Effect.repeat({
      until: (all) => all.every((location) => !location.appsReloading),
      schedule: Schedule.spaced("10 millis"),
    }),
    Effect.asVoid,
  )

export const dispose = async () => {
  await state.stub?.stop()
}
