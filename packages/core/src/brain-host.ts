export * as BrainHost from "./brain-host.js"

import { Database } from "@ren/db/database"
import type { PullRequest } from "@ren/host-api/ren-host-api"
import type { Brain } from "@ren/schema/brain"
import { eq } from "drizzle-orm"
import { Config, Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { BrainClient } from "./brain-client.js"
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
  readonly notify: (brainId: Brain.ID) => Effect.Effect<void>
}

// oxlint-disable-next-line ren/no-comments -- HR12: a push never waits more than 2 s for a brain, and a failure is ignored: the brain's next timed pull brings the change.
const notifyWithin = Duration.seconds(2)

const pushTo = (
  client: BrainClient.Interface,
  brainId: Brain.ID,
  target: Effect.Effect<Option.Option<BrainClient.Target>>,
) =>
  target.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (found) => client.brain(found).pipe(Effect.flatMap((brain) => brain.brain["brain.pull"]())),
      }),
    ),
    Effect.timeout(notifyWithin),
    Effect.catchCause((cause) =>
      Effect.logWarning(`A push to brain ${brainId} failed; it gets the change at its next timed pull`, cause),
    ),
    Effect.asVoid,
  )

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainHost") {}

export const layerCell = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = (yield* Config.URL("CELL_URL")).origin
    const database = yield* Database.Service
    const client = yield* BrainClient.Service
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
      // oxlint-disable-next-line ren/no-comments -- A cell has no egress in front of it: its brains always hold their own keys.
      return {
        brainId,
        generation: row.generation,
        organizationId: row.organizationId,
        url,
        keyIds: row.keyIds,
        egress: false,
      }
    })
    return Service.of({
      target,
      access: (brainId) => Effect.map(target(brainId), (found) => ({ _tag: "Ready", target: found }) as const),
      ensure: () => Effect.void,
      observe: () => Effect.void,
      hand: () => Effect.succeedNone,
      unavailable: () => Effect.void,
      retry: () => Effect.void,
      notify: (brainId) => pushTo(client, brainId, Effect.map(target(brainId), Option.some)),
    })
  }),
)

export const layerSandbox = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* BrainLifecycle.Service
    const client = yield* BrainClient.Service
    return Service.of({
      target: (brainId) =>
        lifecycle.ready(brainId).pipe(Effect.mapError((error) => new BrainFailed({ reason: error.message }))),
      access: lifecycle.access,
      ensure: lifecycle.ensure,
      observe: lifecycle.observe,
      hand: lifecycle.hand,
      unavailable: lifecycle.check,
      retry: lifecycle.retry,
      notify: (brainId) => pushTo(client, brainId, lifecycle.awake(brainId)),
    })
  }),
)
