import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { Deployment } from "../src/deployment.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Layer.empty)

describe("Deployment.sandboxVariables", () => {
  it.effect(
    "gives a sandbox the vendor's telemetry variables and its tenant, never the server's own OTLP headers",
    () =>
      Effect.gen(function* () {
        const variables = yield* Deployment.sandboxVariables.pipe(
          Effect.provideService(Deployment.SandboxTelemetry, { POSTHOG_PROJECT_KEY: "phc_test" }),
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-gateway.grafana.net/otlp",
                OTEL_EXPORTER_OTLP_HEADERS: "authorization=Basic%20grafana-secret",
                REN_DEPLOYMENT: "production",
              }),
            ),
          ),
        )

        expect(variables({ "ren.brain.id": "brn_test" })).toEqual({
          POSTHOG_PROJECT_KEY: "phc_test",
          OTEL_RESOURCE_ATTRIBUTES: "deployment.environment.name=production,ren.brain.id=brn_test",
        })
      }),
  )
})
