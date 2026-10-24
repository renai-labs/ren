export * as CredentialRefresh from "./credential-refresh.js"

import { Database } from "@ren/db/database"
import type { Credential } from "@ren/schema/credential"
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { Clock, Context, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { DurableRunner } from "./durable-runner.js"
import { EgressControl } from "./egress-control.js"

export class Fatal extends Schema.TaggedError<Fatal>()("CredentialRefresh.Fatal", { message: Schema.String }) {}

export class Transient extends Schema.TaggedError<Transient>()("CredentialRefresh.Transient", {
  message: Schema.String,
}) {}

export interface Refresher {
  readonly refresh: (id: Credential.ID) => Effect.Effect<void, Fatal | Transient>
}

export class Refreshers extends Context.Service<Refreshers, ReadonlyMap<Credential.Type, Refresher>>()(
  "@ren/core/CredentialRefresh/Refreshers",
) {}

export const layerNoRefreshers = Layer.succeed(Refreshers, new Map())

export interface Interface {
  readonly sweep: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialRefresh") {}

export const every = Duration.minutes(5)

export const ahead = Duration.minutes(10)

export const lease = Duration.minutes(2)

const RefreshRun = DurableRunner.make("CredentialRefresh", {
  payload: { slot: Schema.String },
  idempotencyKey: (payload) => `credential-refresh:${payload.slot}`,
})

const table = Database.Schema.credential

// oxlint-disable-next-line ren/no-comments -- C51: one sweep for all Ren copies every 5 minutes. Each credential that expires within 10 minutes is taken under a lease, so one refresh runs at a time per credential and a sweep never retries inside one rotation (ren-v1 bug 2). A fatal answer deletes the credential (owner-access §11).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const refreshers = yield* Refreshers
    const control = yield* EgressControl.Service
    const engine = yield* WorkflowEngine.WorkflowEngine

    const refreshOne = Effect.fnUntraced(function* (row: {
      readonly id: Credential.ID
      readonly type: Credential.Type
    }) {
      const refresher = refreshers.get(row.type)
      if (!refresher) return
      const taken = yield* database.db
        .update(table)
        .set({ refresh_lease_at: sql`now()` })
        .where(
          and(
            eq(table.id, row.id),
            or(
              isNull(table.refresh_lease_at),
              lt(table.refresh_lease_at, sql`now() - ${`${Duration.toSeconds(lease)} seconds`}::interval`),
            ),
          ),
        )
        .returning({ id: table.id, label: table.label })
        .pipe(Effect.orDie)
      const found = taken.at(0)
      if (!found) return
      yield* refresher.refresh(row.id).pipe(
        Effect.andThen(
          database.db.update(table).set({ refresh_failures: 0 }).where(eq(table.id, row.id)).pipe(Effect.orDie),
        ),
        Effect.catchTag("CredentialRefresh.Fatal", (error) =>
          database.db
            .delete(table)
            .where(eq(table.id, row.id))
            .pipe(
              Effect.orDie,
              Effect.andThen(control.invalidate({ label: found.label })),
              Effect.andThen(Effect.logWarning(`Credential ${found.label} could not refresh and is removed`, error)),
            ),
        ),
        Effect.catchTag("CredentialRefresh.Transient", (error) =>
          database.db
            .update(table)
            .set({ refresh_failures: sql`${table.refresh_failures} + 1` })
            .where(eq(table.id, row.id))
            .pipe(
              Effect.orDie,
              Effect.andThen(
                Effect.logWarning(`Credential ${found.label} could not refresh; the next sweep tries again`, error),
              ),
            ),
        ),
      )
    })

    const sweep = Effect.gen(function* () {
      const due = yield* database.db
        .select({ id: table.id, type: table.type })
        .from(table)
        .where(
          and(
            isNotNull(table.expires_at),
            lt(table.expires_at, sql`now() + ${`${Duration.toSeconds(ahead)} seconds`}::interval`),
          ),
        )
        .pipe(Effect.orDie)
      yield* Effect.forEach(due, refreshOne, { concurrency: 8, discard: true })
    }).pipe(Effect.withSpan("CredentialRefresh.sweep"))

    yield* DurableRunner.register(RefreshRun, (payload) =>
      DurableRunner.supervise(`credential-refresh:${payload.slot}`, sweep),
    )
    yield* Effect.gen(function* () {
      const slot = Math.floor((yield* Clock.currentTimeMillis) / Duration.toMillis(every))
      yield* DurableRunner.ensure(RefreshRun, { slot: String(slot) })
    }).pipe(
      Effect.repeat(Schedule.spaced(every)),
      Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      Effect.forkScoped,
    )

    return Service.of({ sweep })
  }),
)
