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

export const ReporterVariables = Context.Reference<Readonly<Record<string, string>>>(
  "@ren/core/Deployment/ReporterVariables",
  { defaultValue: () => ({}) },
)

export const sandboxVariables = Effect.gen(function* () {
  const configured = yield* telemetry
  const reporter = yield* ReporterVariables
  return (tenant: Readonly<Record<string, string>>) => ({
    ...Telemetry.variables({ ...configured, attributes: { ...configured.resource.attributes, ...tenant } }),
    ...reporter,
  })
})
