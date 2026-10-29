export * as CredentialRefresh from "./credential-refresh.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Credential } from "@ren/schema/credential"
import { and, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm"
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { Credentials } from "./credentials.js"
import { DurableRunner } from "./durable-runner.js"
import { EgressControl } from "./egress-control.js"
import { Envelope } from "./envelope.js"

export class Fatal extends Schema.TaggedError<Fatal>()("CredentialRefresh.Fatal", { message: Schema.String }) {}

export class Transient extends Schema.TaggedError<Transient>()("CredentialRefresh.Transient", {
  message: Schema.String,
}) {}

export interface Current {
  readonly id: Credential.ID
  readonly organizationId: Auth.OrganizationID
  readonly label: string
  readonly value: Credentials.Sealed
  readonly revision: number
  readonly scopes: ReadonlyArray<string>
  readonly expiresAt: Option.Option<Date>
  readonly provider: Option.Option<Credential.Provider>
  readonly providerAccountId: Option.Option<string>
}

// oxlint-disable-next-line ren/no-comments -- A refresher reads and returns; only the sweep writes (K11). `scopes` keeps the old scopes when absent (§8 rule 4); `saved` runs after the write, for example a Composio cleanup of the old session.
export interface Renewed {
  readonly value: Credentials.Sealed
  readonly expiresAt: Option.Option<Date>
  readonly scopes?: ReadonlyArray<string>
  readonly saved?: Effect.Effect<void>
}

// oxlint-disable-next-line ren/no-comments -- `none` means there is nothing to do now, for example a token without a refresh token before its expiry (§8 rule 5).
export interface Refresher {
  readonly refresh: (current: Current) => Effect.Effect<Option.Option<Renewed>, Fatal | Transient>
}

export class Refreshers extends Context.Service<Refreshers, ReadonlyMap<Credential.Type, Refresher>>()(
  "@ren/core/CredentialRefresh/Refreshers",
) {}

export const layerNoRefreshers = Layer.succeed(Refreshers, new Map())

export interface Interface {
  readonly sweep: Effect.Effect<void>
  readonly refresh: (id: Credential.ID, options: { readonly revision?: number }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialRefresh") {}

export const every = Duration.minutes(5)

export const ahead = Duration.minutes(20)

export const lease = Duration.minutes(2)

export const alertAfter = 3

export const sessionsKept = Duration.days(1)

const RefreshRun = DurableRunner.make("CredentialRefresh", {
  payload: { slot: Schema.String },
  idempotencyKey: (payload) => `credential-refresh:${payload.slot}`,
})

const table = Database.Schema.credential
const apps = Database.Schema.oauth_app

const SealedJson = Schema.fromJsonString(Credentials.Sealed)
const encodeSealed = Schema.encodeSync(SealedJson)
const decodeSealed = Schema.decodeUnknownOption(SealedJson)

// oxlint-disable-next-line ren/no-comments -- C51: one sweep for all Ren copies every 5 minutes, for credentials that expire within 20 minutes (K12). One lease per credential, so one refresh runs at a time (ren-v1 bug 2). The write checks the revision that was read, so a reconnect that saved meanwhile wins (K11, U3). A fatal answer keeps the row with status `reconnect` and a cleared value (K13); a temporary one counts and alerts after 3 in a row (K14).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const refreshers = yield* Refreshers
    const control = yield* EgressControl.Service
    const envelope = yield* Envelope.Service
    const engine = yield* WorkflowEngine.WorkflowEngine

    const contextOf = (row: { readonly organization_id: Auth.OrganizationID; readonly id: Credential.ID }) => ({
      organizationId: row.organization_id,
      kind: "credential" as const,
      id: row.id,
    })

    const seal = (row: Parameters<typeof contextOf>[0], value: Credentials.Sealed) =>
      envelope.seal(Redacted.make(encodeSealed(value)), contextOf(row)).pipe(Effect.orDie)

    const write = Effect.fnUntraced(function* (
      rows: ReadonlyArray<typeof table.$inferSelect>,
      set: Partial<typeof table.$inferInsert>,
      value: Credentials.Sealed,
    ) {
      const row = rows.at(0)
      if (!row) return false
      const values = yield* Effect.forEach(rows, (each) =>
        Effect.map(seal(each, value), (sealed) => ({ row: each, value: sealed })),
      )
      const written = yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const current = (yield* transaction.select().from(table).where(eq(table.id, row.id)).for("update")).at(0)
            if (!current || current.revision !== row.revision) return false
            yield* Effect.forEach(values, (each) =>
              transaction
                .update(table)
                .set({
                  ...set,
                  value: each.value,
                  revision: sql`${table.revision} + 1`,
                  refresh_lease_at: null,
                  updated_at: sql`now()`,
                })
                .where(and(eq(table.id, each.row.id), eq(table.revision, each.row.revision))),
            )
            return true
          }),
        )
        .pipe(Effect.orDie)
      if (!written) {
        yield* Effect.logInfo(`Credential ${row.label} changed during its refresh; Ren keeps the newer value`)
        return false
      }
      yield* control.invalidate({ label: row.label })
      return true
    })

    const release = (row: typeof table.$inferSelect, options: { readonly failed: boolean }) =>
      database.db
        .update(table)
        .set({
          refresh_lease_at: null,
          ...(options.failed && { refresh_failures: sql`${table.refresh_failures} + 1` }),
        })
        .where(eq(table.id, row.id))
        .returning({ failures: table.refresh_failures })
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.at(0)?.failures ?? 0),
        )

    const refresh = Effect.fn("CredentialRefresh.refresh")(function* (
      id: Credential.ID,
      options: { readonly revision?: number },
    ) {
      const now = yield* Clock.currentTimeMillis
      const requested = (yield* database.db.select().from(table).where(eq(table.id, id)).pipe(Effect.orDie)).at(0)
      if (!requested || (typeof options.revision === "number" && requested.revision !== options.revision)) return
      const rows =
        requested.owner === "person" && requested.label === "GITHUB"
          ? yield* database.db
              .select()
              .from(table)
              .where(
                and(
                  eq(table.owner, "person"),
                  eq(table.label, requested.label),
                  sql`${table.user_id} = ${requested.user_id}`,
                  sql`${table.provider_account_id} is not distinct from ${requested.provider_account_id}`,
                ),
              )
              .orderBy(table.id)
              .pipe(Effect.orDie)
          : [requested]
      const owner = rows.at(0)
      if (!owner) return
      if (rows.find((row) => row.id === requested.id)?.revision !== requested.revision) return
      const taken = yield* database.db
        .update(table)
        .set({ refresh_lease_at: new Date(now) })
        .where(
          and(
            eq(table.id, owner.id),
            eq(table.status, "ok"),
            eq(table.revision, owner.revision),
            or(isNull(table.refresh_lease_at), lt(table.refresh_lease_at, new Date(now - Duration.toMillis(lease)))),
          ),
        )
        .returning()
        .pipe(Effect.orDie)
      const row = taken.at(0)
      if (!row) return
      const refresher = refreshers.get(row.type)
      const opened = yield* envelope.open(row.value, contextOf(row)).pipe(Effect.orDie)
      const value = decodeSealed(Redacted.value(opened))
      if (!refresher || Option.isNone(value)) {
        yield* release(row, { failed: false })
        return
      }
      yield* refresher
        .refresh({
          id: row.id,
          organizationId: row.organization_id,
          label: row.label,
          value: value.value,
          revision: row.revision,
          scopes: row.scopes,
          expiresAt: Option.fromNullishOr(row.expires_at),
          provider: Option.fromNullishOr(row.provider),
          providerAccountId: Option.fromNullishOr(row.provider_account_id),
        })
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => release(row, { failed: false }),
              onSome: (renewed) =>
                Effect.gen(function* () {
                  const saved = yield* write(
                    rows,
                    {
                      expires_at: Option.getOrNull(renewed.expiresAt),
                      ...(renewed.scopes && { scopes: [...renewed.scopes] }),
                      refresh_failures: 0,
                    },
                    renewed.value,
                  )
                  if (saved && renewed.saved) yield* renewed.saved
                }),
            }),
          ),
          Effect.catchTag("CredentialRefresh.Fatal", (error) =>
            Effect.gen(function* () {
              yield* write(rows, { status: "reconnect" }, { type: "cleared" })
              yield* Effect.logWarning(`Credential ${row.label} could not refresh and needs a reconnect`, error)
            }),
          ),
          Effect.catchTag("CredentialRefresh.Transient", (error) =>
            Effect.gen(function* () {
              const failures = yield* release(row, { failed: true })
              yield* Effect.logWarning(`Credential ${row.label} could not refresh; Ren tries again`, error)
              if (failures === alertAfter)
                yield* Effect.logError(`A credential failed to refresh ${alertAfter} times in a row`).pipe(
                  Effect.annotateLogs({ "ren.credential.id": row.id, "ren.credential.label": row.label }),
                )
            }),
          ),
        )
    })

    const sweep = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const types = [...refreshers.keys()]
      const due =
        types.length === 0
          ? []
          : yield* database.db
              .select({ id: table.id, revision: table.revision })
              .from(table)
              .where(
                and(
                  eq(table.status, "ok"),
                  inArray(table.type, types),
                  isNotNull(table.expires_at),
                  lt(table.expires_at, new Date(now + Duration.toMillis(ahead))),
                  notExists(
                    database.db
                      .select({ one: sql`1` })
                      .from(apps)
                      .where(and(eq(apps.id, table.oauth_app_id), isNotNull(apps.archived_at))),
                  ),
                ),
              )
              .pipe(Effect.orDie)
      yield* Effect.forEach(due, (row) => refresh(row.id, { revision: row.revision }), {
        concurrency: 8,
        discard: true,
      })
      yield* database.db
        .delete(Database.Schema.oauth_session)
        .where(lt(Database.Schema.oauth_session.created_at, new Date(now - Duration.toMillis(sessionsKept))))
        .pipe(Effect.orDie)
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
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    return Service.of({ sweep, refresh })
  }),
)
