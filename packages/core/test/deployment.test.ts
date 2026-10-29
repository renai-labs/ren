import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { Deployment } from "../src/deployment.js"
import { testEffect } from "./lib/effect.js"

const telemetry = (config: Record<string, string>) =>
  Deployment.telemetry.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))))

const posthog = (signal: string) =>
  Option.some({ url: `https://eu.i.posthog.com/i/v1/${signal}`, headers: { authorization: "Bearer phc_test" } })

const project = { POSTHOG_PROJECT_KEY: "phc_test", POSTHOG_HOST: "https://eu.i.posthog.com" }

const it = testEffect(Layer.empty)

describe("Deployment.telemetry", () => {
  it.effect("sends traces and logs to PostHog when PostHog is configured", () =>
    Effect.gen(function* () {
      const configured = yield* telemetry(project)
      expect([configured.traces, configured.logs]).toEqual([posthog("traces"), posthog("logs")])
    }),
  )

  it.effect("sends a signal to the standard OTLP endpoint instead, with its headers", () =>
    Effect.gen(function* () {
      const configured = yield* telemetry({
        ...project,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp.example.com/v1/traces",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=Bearer%20abc%20123, x-team=ren",
      })
      expect(configured.traces).toEqual(
        Option.some({
          url: "https://otlp.example.com/v1/traces",
          headers: { authorization: "Bearer abc 123", "x-team": "ren" },
        }),
      )
      expect(configured.logs).toEqual(posthog("logs"))
    }),
  )

  it.effect("turns a signal off with the standard exporter variable", () =>
    Effect.gen(function* () {
      const configured = yield* telemetry({ ...project, OTEL_TRACES_EXPORTER: "none" })
      expect([configured.traces, configured.logs]).toEqual([Option.none(), posthog("logs")])
    }),
  )

  it.effect("sends nothing without configuration", () =>
    Effect.gen(function* () {
      const configured = yield* telemetry({})
      expect([configured.traces, configured.logs]).toEqual([Option.none(), Option.none()])
    }),
  )
})
