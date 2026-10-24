export * as OAuthApps from "./oauth-apps.js"

import { Database } from "@ren/db/database"
import { OAuthApp } from "@ren/schema/oauth-app"
import { and, asc, count, eq, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Redacted, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { EgressControl } from "./egress-control.js"
import { Envelope } from "./envelope.js"
import { Primitive } from "./primitive.js"
import { TaskPolicy } from "./task/policy.js"

export interface Interface extends Omit<Primitive.Interface<typeof OAuthApp.definition>, "archive"> {
  readonly archive: (
    actor: Actor.Info,
    id: OAuthApp.ID,
    options?: { readonly force?: boolean },
  ) => Effect.Effect<OAuthApp.Info, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/OAuthApps") {}

const table = Database.Schema.oauth_app
const credentials = Database.Schema.credential

const notFound = new Primitive.NotFound({ message: "OAuth app not found." })

const toInfo = (row: typeof table.$inferSelect): OAuthApp.Info => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  clientId: row.client_id,
  hasClientSecret: row.client_secret !== null,
  scopes: row.scopes,
  discovery: row.discovery,
  authorizationEndpoint: row.authorization_endpoint,
  tokenEndpoint: row.token_endpoint,
  tokenEndpointAuth: row.token_endpoint_auth,
  resource: row.resource,
  authorizeParams: row.authorize_params,
  configuredBy: row.configured_by_user_id,
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const nameTaken = Primitive.uniqueConflict(
  "oauth_app_name_uidx",
  "The org already has an OAuth app with this name (NameTaken).",
)

// oxlint-disable-next-line ren/no-comments -- owner-access §7 and §11: an org's own OAuth clients. The secret is sealed with the app id; Ren never returns it. An app is archived, never deleted, because MCPs name it; an archive while credentials use it needs `force`, which deletes them.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const envelope = yield* Envelope.Service
    const control = yield* EgressControl.Service

    const allowed = (actor: Actor.Info, operation: "list" | "get" | "create" | "update" | "archive") =>
      access.isAllowed({
        actor,
        action: Primitive.action(OAuthApp.definition, operation),
        resource: TaskPolicy.organization,
      })
        ? Effect.void
        : Effect.fail(new Primitive.Forbidden({ message: "You cannot change OAuth apps." }))

    const own = (actor: Actor.Info) => eq(table.organization_id, actor.organizationId)

    const find = Effect.fnUntraced(function* (actor: Actor.Info, id: string) {
      if (!Schema.is(OAuthApp.ID)(id)) return yield* notFound
      const row = (yield* database.db
        .select()
        .from(table)
        .where(and(eq(table.id, id), own(actor)))
        .pipe(Effect.orDie)).at(0)
      if (!row) return yield* notFound
      return row
    })

    const sealSecret = (actor: Actor.Info, id: OAuthApp.ID, secret: Redacted.Redacted | undefined) =>
      secret === undefined
        ? Effect.succeed(undefined)
        : envelope.seal(secret, { organizationId: actor.organizationId, kind: "oauth_app", id }).pipe(Effect.orDie)

    return Service.of({
      list: Effect.fn("OAuthApps.list")(function* (actor: Actor.Info, input: OAuthApp.ListInput) {
        yield* allowed(actor, "list").pipe(Effect.orDie)
        const where = and(own(actor), isNull(table.archived_at))
        const rows = yield* database.db
          .select()
          .from(table)
          .where(where)
          .orderBy(asc(table.name))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize)
          .pipe(Effect.orDie)
        const totals = yield* database.db.select({ total: count() }).from(table).where(where).pipe(Effect.orDie)
        return { items: rows.map(toInfo), page: input.page, pageSize: input.pageSize, total: totals.at(0)?.total ?? 0 }
      }),

      get: Effect.fn("OAuthApps.get")(function* (actor: Actor.Info, id: string) {
        return toInfo(yield* find(actor, id))
      }),

      create: Effect.fn("OAuthApps.create")(function* (actor: Actor.Info, input: OAuthApp.CreateInput) {
        yield* allowed(actor, "create")
        const id = OAuthApp.ID.create()
        const rows = yield* database.db
          .insert(table)
          .values({
            id,
            organization_id: actor.organizationId,
            name: input.name,
            client_id: input.clientId,
            client_secret: yield* sealSecret(actor, id, input.clientSecret),
            scopes: [...(input.scopes ?? [])],
            discovery: input.discovery ?? "live",
            authorization_endpoint: input.authorizationEndpoint ?? null,
            token_endpoint: input.tokenEndpoint ?? null,
            token_endpoint_auth: input.tokenEndpointAuth ?? (input.clientSecret ? "client_secret_post" : "none"),
            resource: input.resource ?? null,
            authorize_params: input.authorizeParams ?? {},
            configured_by_user_id: actor.userId,
          })
          .returning()
          .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken), Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* Effect.die(new Error("The OAuth app was not saved"))
        return toInfo(row)
      }),

      update: Effect.fn("OAuthApps.update")(function* (
        actor: Actor.Info,
        id: OAuthApp.ID,
        input: OAuthApp.UpdateInput,
      ) {
        yield* allowed(actor, "update")
        yield* find(actor, id)
        const rows = yield* database.db
          .update(table)
          .set({
            name: input.name,
            client_id: input.clientId,
            client_secret: yield* sealSecret(actor, id, input.clientSecret),
            scopes: input.scopes && [...input.scopes],
            discovery: input.discovery,
            authorization_endpoint: input.authorizationEndpoint,
            token_endpoint: input.tokenEndpoint,
            token_endpoint_auth: input.tokenEndpointAuth,
            resource: input.resource,
            authorize_params: input.authorizeParams,
            updated_at: sql`now()`,
          })
          .where(eq(table.id, id))
          .returning()
          .pipe(Effect.catchTag("EffectDrizzleQueryError", nameTaken), Effect.orDie)
        const row = rows.at(0)
        if (!row) return yield* notFound
        return toInfo(row)
      }),

      archive: Effect.fn("OAuthApps.archive")(function* (
        actor: Actor.Info,
        id: OAuthApp.ID,
        options: { readonly force?: boolean } = {},
      ) {
        yield* allowed(actor, "archive")
        const row = yield* find(actor, id)
        if (row.archived_at) return toInfo(row)
        const issued = yield* database.db
          .select({ id: credentials.id, label: credentials.label })
          .from(credentials)
          .where(eq(credentials.oauth_app_id, id))
          .pipe(Effect.orDie)
        if (issued.length > 0 && !options.force)
          return yield* new Primitive.Conflict({
            message: `${issued.length} credentials use this app. Archive with force to delete them (InUse).`,
          })
        yield* database.db.delete(credentials).where(eq(credentials.oauth_app_id, id)).pipe(Effect.orDie)
        yield* Effect.forEach(issued, (credential) => control.invalidate({ label: credential.label }), {
          discard: true,
        })
        const rows = yield* database.db
          .update(table)
          .set({ archived_at: sql`now()`, updated_at: sql`now()` })
          .where(eq(table.id, id))
          .returning()
          .pipe(Effect.orDie)
        const archived = rows.at(0)
        if (!archived) return yield* notFound
        return toInfo(archived)
      }),
    })
  }),
)
