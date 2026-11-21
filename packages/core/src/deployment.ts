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

// oxlint-disable-next-line ren/no-comments -- Where machines reach this Ren; none for a Ren that machines do not call.
export const renUrl = Config.option(Config.String("REN_URL"))

// oxlint-disable-next-line ren/no-comments -- Hosts that a machine started before a rename still calls, as `previous=current,…`. Ren adds each previous host wherever its current host is named, so the machine keeps working. Remove an entry when no machine from before the rename runs.
export const previousHosts = Config.String("REN_PREVIOUS_HOSTS").pipe(
  Config.withDefault(""),
  Config.map((value) =>
    value
      .split(",")
      .map((entry) => entry.trim().split("="))
      .filter((pair) => pair.length === 2)
      .map((pair) => ({ previous: pair.at(0) ?? "", current: pair.at(1) ?? "" })),
  ),
)

export const withPreviousHosts = Effect.map(previousHosts, (renames) => (hosts: ReadonlyArray<string>) => [
  ...hosts,
  ...renames.filter((rename) => hosts.includes(rename.current)).map((rename) => rename.previous),
])
