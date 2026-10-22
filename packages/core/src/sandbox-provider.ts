export * as SandboxProvider from "./sandbox-provider.js"

import type { Brain } from "@ren/schema/brain"
import { Context, type Duration, type Effect, Schema } from "effect"

export class Gone extends Schema.TaggedError<Gone>()("SandboxProvider.Gone", { message: Schema.String }) {}

export class Failed extends Schema.TaggedError<Failed>()("SandboxProvider.Failed", { message: Schema.String }) {}

export class Capacity extends Schema.TaggedError<Capacity>()("SandboxProvider.Capacity", {
  message: Schema.String,
  retryAfter: Schema.Duration,
}) {}

export type Status = "running" | "paused" | "gone"

export interface Created {
  readonly binding: Schema.Json
  readonly url: string
}

export interface Listed {
  readonly binding: Schema.Json
  readonly brainId: Brain.ID
  readonly generation: number
}

export interface Interface {
  readonly kind: string
  readonly create: (input: {
    readonly brainId: Brain.ID
    readonly generation: number
    readonly env: Readonly<Record<string, string>>
  }) => Effect.Effect<Created, Failed | Capacity>
  readonly connect: (binding: Schema.Json) => Effect.Effect<{ readonly url: string }, Gone | Failed | Capacity>
  readonly keepAlive: (binding: Schema.Json, duration: Duration.Duration) => Effect.Effect<void, Gone | Failed>
  readonly destroy: (binding: Schema.Json) => Effect.Effect<void, Failed>
  readonly status: (binding: Schema.Json) => Effect.Effect<Status, Failed>
  readonly list: Effect.Effect<ReadonlyArray<Listed>, Failed>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SandboxProvider") {}
