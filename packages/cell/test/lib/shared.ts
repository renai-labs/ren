export * as Shared from "./shared.js"

import { Celld } from "./celld.js"
import { StubModel } from "./stub-model.js"
import { TestToken } from "./token.js"

const state: { stub: StubModel.Server | undefined; celld: Promise<Celld.Instance> | undefined } = {
  stub: undefined,
  celld: undefined,
}

export const stub = () => (state.stub ??= StubModel.start())

export const vars = () => ({
  ...TestToken.vars,
  ALARM_INTERVAL_MS: "1000",
  WAIT_BUDGET_MS: "3000",
  PARK_AFTER_MS: "2000",
  OPENCODE_CONFIG: JSON.stringify({
    model: "stub/stub-model",
    providers: {
      stub: {
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL: stub().cellUrl, apiKey: "stub-key" },
        models: { "stub-model": { name: "Stub", limit: { context: 100_000, output: 4000 } } },
      },
    },
  }),
})

export const celld = () => (state.celld ??= Celld.make(vars()))

export const dispose = async () => {
  await state.celld?.then((instance) => instance.dispose())
  await state.stub?.stop()
}
