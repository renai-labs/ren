export * as PersonCredentials from "./person-credentials.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Credentials } from "./credentials.js"
import { EgressControl } from "./egress-control.js"
import { Envelope } from "./envelope.js"

export interface Account {
  readonly id: string
  readonly name: string
}

export interface Saved {
  readonly label: string
  readonly account: Account
  readonly hosts: ReadonlyArray<string>
  readonly value: Extract<Credentials.Sealed, { readonly type: "oauth" }>
  readonly expiresAt?: Date
}

export interface Interface {
  readonly save: (organizationId: Auth.OrganizationID, userId: Auth.UserID, saved: Saved) => Effect.Effect<void>
  readonly remove: (userId: Auth.UserID, label: string) => Effect.Effect<void>
  readonly account: (
    organizationId: Auth.OrganizationID,
    userId: Auth.UserID,
    label: string,
  ) => Effect.Effect<Option.Option<Account>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/PersonCredentials") {}

const encode = Schema.encodeSync(Schema.fromJsonString(Credentials.Sealed))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const envelope = yield* Envelope.Service
    const control = yield* EgressControl.Service
    const table = Database.Schema.credential
    const owned = (organizationId: Auth.OrganizationID, userId: Auth.UserID, label: string) =>
      and(
        eq(table.organization_id, organizationId),
        eq(table.owner, "person"),
        eq(table.user_id, userId),
        eq(table.label, label),
      )
    return Service.of({
      save: Effect.fn("PersonCredentials.save")(function* (
        organizationId: Auth.OrganizationID,
        userId: Auth.UserID,
        saved: Saved,
      ) {
        const columns = {
          type: "oauth" as const,
          name: saved.account.name,
          provider_account_id: saved.account.id,
          hosts: [...saved.hosts],
          inject: { op: "replace", in: ["header"] } satisfies Credential.Inject,
          expires_at: saved.expiresAt ?? null,
          account_user_id: userId,
        }
        yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .select({ id: Database.Schema.user.id })
                .from(Database.Schema.user)
                .where(eq(Database.Schema.user.id, userId))
                .for("update")
              const existing = yield* transaction
                .select()
                .from(table)
                .where(and(eq(table.owner, "person"), eq(table.user_id, userId), eq(table.label, saved.label)))
                .orderBy(table.id)
                .for("update")
              yield* Effect.forEach(existing, (row) =>
                Effect.gen(function* () {
                  const value = yield* envelope
                    .seal(Redacted.make(encode(saved.value)), {
                      organizationId: row.organization_id,
                      kind: "credential",
                      id: row.id,
                    })
                    .pipe(Effect.orDie)
                  yield* transaction
                    .update(table)
                    .set({
                      ...columns,
                      value,
                      status: "ok",
                      revision: sql`${table.revision} + 1`,
                      refresh_failures: 0,
                      refresh_lease_at: null,
                      updated_at: sql`now()`,
                    })
                    .where(eq(table.id, row.id))
                }),
              )
              if (existing.some((row) => row.organization_id === organizationId)) return
              const id = Credential.ID.create()
              const value = yield* envelope
                .seal(Redacted.make(encode(saved.value)), {
                  organizationId,
                  kind: "credential",
                  id,
                })
                .pipe(Effect.orDie)
              yield* transaction.insert(table).values({
                ...columns,
                value,
                id,
                organization_id: organizationId,
                owner: "person",
                user_id: userId,
                label: saved.label,
                created_by_user_id: userId,
              })
            }),
          )
          .pipe(Effect.orDie)
        yield* control.invalidate({ label: saved.label })
      }),
      remove: Effect.fn("PersonCredentials.remove")(function* (userId: Auth.UserID, label: string) {
        const removed = yield* database.db
          .delete(table)
          .where(and(eq(table.owner, "person"), eq(table.user_id, userId), eq(table.label, label)))
          .returning({ id: table.id })
          .pipe(Effect.orDie)
        if (removed.length > 0) yield* control.invalidate({ label })
      }),
      account: Effect.fn("PersonCredentials.account")(function* (
        organizationId: Auth.OrganizationID,
        userId: Auth.UserID,
        label: string,
      ) {
        const row = (yield* database.db
          .select({ id: table.provider_account_id, name: table.name })
          .from(table)
          .where(and(owned(organizationId, userId, label), eq(table.status, "ok")))
          .pipe(Effect.orDie)).at(0)
        return row?.id && row.name ? Option.some({ id: row.id, name: row.name }) : Option.none()
      }),
    })
  }),
)
