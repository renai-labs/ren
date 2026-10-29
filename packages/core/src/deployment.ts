export * as Deployment from "./deployment.js"

import type { Telemetry } from "@ren/util/telemetry"
import { Config, Effect, Option } from "effect"
import { PostHog } from "./posthog.js"

export const resource = Config.all({
  version: Config.String("REN_VERSION").pipe(Config.withDefault("development")),
  environment: Config.String("REN_DEPLOYMENT").pipe(Config.withDefault("development")),
}).pipe(
  Config.map((config): Telemetry.Resource => ({
    serviceName: "ren-server",
    serviceVersion: config.version,
    attributes: { "deployment.environment.name": config.environment },
  })),
)

const headers = (value: string) =>
  Object.fromEntries(
    value
      .split(",")
      .filter((pair) => pair.includes("="))
      .map((pair) => {
        const separator = pair.indexOf("=")
        return [
          decodeURIComponent(pair.slice(0, separator).trim()),
          decodeURIComponent(pair.slice(separator + 1).trim()),
        ]
      }),
  )

const target = (signal: "traces" | "logs" | "metrics") =>
  Effect.gen(function* () {
    const name = signal.toUpperCase()
    const exporter = yield* Config.Literals(["otlp", "none"], `OTEL_${name}_EXPORTER`).pipe(Config.withDefault("otlp"))
    if (exporter === "none") return Option.none<Telemetry.Target>()
    const endpoint = yield* Config.option(Config.String(`OTEL_EXPORTER_OTLP_${name}_ENDPOINT`))
    if (Option.isSome(endpoint))
      return Option.some<Telemetry.Target>({
        url: endpoint.value,
        headers: headers(yield* Config.String(`OTEL_EXPORTER_OTLP_${name}_HEADERS`).pipe(Config.withDefault(""))),
      })
    return Option.map(yield* Config.option(PostHog.project), (project): Telemetry.Target => ({
      url: `${project.host}/i/v1/${signal}`,
      headers: { authorization: `Bearer ${project.key}` },
    }))
  })

export const telemetry = Effect.all({
  resource,
  traces: target("traces"),
  logs: target("logs"),
  metrics: target("metrics"),
})
