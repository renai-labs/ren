export * as EnvironmentTelemetry from "./telemetry.js"

import type { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Context, Duration, type Effect } from "effect"

export const drainEvery = Duration.seconds(5)

export interface Interface {
  readonly forward: (drained: EnvironmentApi.Drained) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/EnvironmentTelemetry") {}
