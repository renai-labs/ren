export * as Deployment from "./deployment.js"

import { Telemetry } from "@ren/telemetry/telemetry"
import { Config, Context, Effect } from "effect"

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

export const telemetry = Effect.all({ resource, targets: Telemetry.targets }).pipe(
  Effect.map((found) => ({ resource: found.resource, ...found.targets })),
)

export const SandboxTelemetry = Context.Reference<Readonly<Record<string, string>>>(
  "@ren/core/Deployment/SandboxTelemetry",
  { defaultValue: () => ({}) },
)

export const sandboxVariables = Effect.gen(function* () {
  const server = yield* resource
  const vendor = yield* SandboxTelemetry
  return (tenant: Readonly<Record<string, string>>) => ({
    ...vendor,
    ...Telemetry.variables({ ...server.attributes, ...tenant }),
  })
})
