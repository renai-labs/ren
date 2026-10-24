export * as SignIn from "./sign-in.js"

import { Database } from "@ren/db/database"
import type { Credential } from "@ren/schema/credential"
import type { Envelope } from "@ren/schema/envelope"
import { and, eq, sql } from "drizzle-orm"
import { Cause, Effect, Option, Result } from "effect"
import { SqlError } from "effect/sql"

const credentials = Database.Schema.credential

export type Session = typeof Database.Schema.oauth_session.$inferSelect

export interface Columns {
  readonly type: Credential.Type
  readonly value: Envelope.Sealed
  readonly hosts: ReadonlyArray<string>
  readonly inject: Credential.Inject
  readonly scopes?: ReadonlyArray<string>
  readonly expiresAt?: Date | null
  readonly accountSubjectHash?: string | null
  readonly oauthAppId?: typeof credentials.$inferInsert.oauth_app_id
  readonly provider?: Credential.Provider
  readonly providerAccountId?: string
}

const isLabelTaken = (cause: unknown) => {
  const failure = Cause.isCause(cause) ? Cause.findErrorOption(cause) : Option.none()
  return (
    Option.isSome(failure) &&
    SqlError.isSqlError(failure.value) &&
    failure.value.reason._tag === "UniqueViolation" &&
    failure.value.reason.constraint === Database.Schema.credentialOwnerLabelConstraints.profile
  )
}

// oxlint-disable-next-line ren/no-comments -- profiles.md §9 rules 7 and 9, P27: a reconnect writes the same row and makes its person the holder; a first connect inserts the row from the session alone. When another first connect saved the item meanwhile, this one fails and names that holder.
export const save: (
  db: Database.Interface["db"],
  taken: Session,
  columns: Columns,
) => Effect.Effect<Result.Result<string, string>> = Effect.fnUntraced(function* (
  db: Database.Interface["db"],
  taken: Session,
  columns: Columns,
) {
  if (!taken.profile_id) return Result.fail("This profile was deleted.")
  const set = {
    type: columns.type,
    value: columns.value,
    hosts: [...columns.hosts],
    inject: columns.inject,
    scopes: [...(columns.scopes ?? [])],
    expires_at: columns.expiresAt ?? null,
    account_subject_hash: columns.accountSubjectHash ?? null,
    oauth_app_id: columns.oauthAppId ?? null,
    provider: columns.provider ?? null,
    provider_account_id: columns.providerAccountId ?? null,
    account_user_id: taken.initiator_user_id,
    made_for: taken.made_for,
  }
  const saved = yield* db
    .update(credentials)
    .set({
      ...set,
      status: "ok",
      revision: sql`${credentials.revision} + 1`,
      wanted_scopes: [],
      refresh_failures: 0,
      updated_at: sql`now()`,
    })
    .where(eq(credentials.id, taken.credential_id))
    .returning({ id: credentials.id })
    .pipe(Effect.orDie)
  if (saved.length > 0) return Result.succeed(taken.label)
  const inserted = yield* db
    .insert(credentials)
    .values({
      ...set,
      id: taken.credential_id,
      organization_id: taken.organization_id,
      owner: "profile",
      profile_id: taken.profile_id,
      label: taken.label,
      name: taken.name,
      created_by_user_id: taken.initiator_user_id,
    })
    .pipe(
      Effect.as(true),
      Effect.catchTag("EffectDrizzleQueryError", (error) =>
        isLabelTaken(error.cause) ? Effect.succeed(false) : Effect.die(error),
      ),
    )
  if (inserted) return Result.succeed(taken.label)
  const holder = (yield* db
    .select({ name: Database.Schema.user.name })
    .from(credentials)
    .leftJoin(Database.Schema.user, eq(Database.Schema.user.id, credentials.account_user_id))
    .where(and(eq(credentials.profile_id, taken.profile_id), eq(credentials.label, taken.label)))
    .pipe(Effect.orDie)).at(0)
  return Result.fail(`${holder?.name ?? "Someone"} connected this first.`)
})
