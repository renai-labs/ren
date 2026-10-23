export * as BrainHost from "./brain-host.js"

import { Database } from "@ren/db/database"
import type { PullRequest } from "@ren/host-api/ren-host-api"
import type { Brain } from "@ren/schema/brain"
import { eq } from "drizzle-orm"
import { Config, Context, Effect, Layer, type Option, Schema } from "effect"
import type { BrainClient } from "./brain-client.js"
import { BrainLifecycle } from "./brain-lifecycle.js"
import type { SandboxProvider } from "./sandbox-provider.js"

export class BrainUnavailable extends Schema.TaggedError<BrainUnavailable>()("BrainUnavailable", {
  cause: Schema.Defect(),
}) {}

export class BrainFailed extends Schema.TaggedError<BrainFailed>()("BrainFailed", { reason: Schema.String }) {}

export interface Interface {
  readonly target: (brainId: Brain.ID) => Effect.Effect<BrainClient.Target, BrainUnavailable | BrainFailed>
  readonly access: (brainId: Brain.ID) => Effect.Effect<BrainLifecycle.Access>
  readonly ensure: (brainId: Brain.ID) => Effect.Effect<void>
  readonly observe: (brainId: Brain.ID, sessions: PullRequest["sessions"]) => Effect.Effect<void>
  readonly hand: (brainId: Brain.ID) => Effect.Effect<Option.Option<SandboxProvider.Hand>>
  readonly unavailable: (brainId: Brain.ID) => Effect.Effect<void>
  readonly retry: (brainId: Brain.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainHost") {}

export const layerCell = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = (yield* Config.URL("CELL_URL")).origin
    const database = yield* Database.Service
    const target = Effect.fnUntraced(function* (brainId: Brain.ID) {
      const row = (yield* database.db
        .select({
          organizationId: Database.Schema.brain.organization_id,
          generation: Database.Schema.brain.generation,
          keyIds: Database.Schema.brain.key_ids,
        })
        .from(Database.Schema.brain)
        .where(eq(Database.Schema.brain.id, brainId))
        .pipe(Effect.orDie)).at(0)
      if (!row) return yield* Effect.die(new Error(`Brain ${brainId} does not exist`))
      return { brainId, generation: row.generation, organizationId: row.organizationId, url, keyIds: row.keyIds }
    })
    return Service.of({
      target,
      access: (brainId) => Effect.map(target(brainId), (found) => ({ _tag: "Ready", target: found }) as const),
      ensure: () => Effect.void,
      observe: () => Effect.void,
      hand: () => Effect.succeedNone,
      unavailable: () => Effect.void,
      retry: () => Effect.void,
    })
  }),
)

export const layerSandbox = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* BrainLifecycle.Service
    return Service.of({
      target: (brainId) =>
        lifecycle.ready(brainId).pipe(Effect.mapError((error) => new BrainFailed({ reason: error.message }))),
      access: lifecycle.access,
      ensure: lifecycle.ensure,
      observe: lifecycle.observe,
      hand: lifecycle.hand,
      unavailable: lifecycle.check,
      retry: lifecycle.retry,
    })
  }),
)
