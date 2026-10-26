export * as ChannelInstalls from "./channel-installs.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { ChannelInstall } from "@ren/schema/channel-install"
import type { WriteResult } from "@ren/schema/write-result"
import { and, asc, count, desc, eq, isNull } from "drizzle-orm"
import { Clock, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Random } from "@ren/util/random"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { ChannelInstallPolicy } from "./channel-install/policy.js"
import { ChannelProvider } from "./channel-provider.js"
import { ChannelSecrets } from "./channel-secrets.js"
import { PersonCredentials } from "./person-credentials.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"

export type Outcome =
  | { readonly ok: true; readonly provider: Channel.Provider; readonly name: string | null }
  | { readonly ok: false; readonly reason: string }

export interface Interface extends Primitive.Interface<typeof ChannelInstall.definition> {
  readonly providers: Effect.Effect<typeof ChannelInstall.ProviderInfos.Type>
  readonly start: (
    actor: Actor.Info,
    input: ChannelInstall.StartInput,
  ) => Effect.Effect<
    WriteResult.Redirect,
    Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict | Primitive.Invalid
  >
  readonly complete: (
    provider: string,
    query: Readonly<Record<string, string>>,
    browser: Option.Option<Auth.UserID>,
  ) => Effect.Effect<Outcome>
  readonly removeByWorkspace: (provider: Channel.Provider, workspace: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelInstalls") {}

const table = Database.Schema.channel_install
const states = Database.Schema.channel_install_state
const users = Database.Schema.user
const accounts = Database.Schema.account
const spaces = Database.Schema.space

const notFound = new Primitive.NotFound({ message: "Install not found." })

const failed = (reason: string): Outcome => ({ ok: false, reason })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const registry = yield* ChannelProvider.Registry
    const people = yield* PersonCredentials.Service
    const secrets = yield* ChannelSecrets.Service

    const accountsOf = (userId: Auth.UserID, provider: Channel.Provider) =>
      database.db
        .select({ accountId: accounts.accountId })
        .from(accounts)
        .where(and(eq(accounts.providerId, provider), eq(accounts.userId, userId)))
        .orderBy(desc(accounts.updatedAt))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => row.accountId)),
        )

    const mayChange = (actor: Actor.Info, installedBy: Auth.UserID | null) =>
      access.isAllowed({
        actor,
        action: Primitive.action(ChannelInstall.definition, "update"),
        resource: ChannelInstallPolicy.resource(installedBy === actor.userId),
      })

    const toInfo =
      (actor: Actor.Info) =>
      (row: {
        readonly install: typeof table.$inferSelect
        readonly installer: { readonly id: string; readonly name: string } | null
        readonly defaultSpace: ChannelInstall.Info["defaultSpace"]
      }): ChannelInstall.Info => ({
        id: row.install.id,
        provider: row.install.provider,
        workspace: row.install.workspace,
        name: row.install.name,
        installedBy: row.installer && { id: Auth.UserID.make(row.installer.id), name: row.installer.name },
        defaultSpace: row.defaultSpace,
        canUpdate: mayChange(actor, row.install.installed_by),
        createdAt: DateTime.fromDateUnsafe(row.install.created_at),
      })

    const allowed = (actor: Actor.Info) =>
      access.isAllowed({
        actor,
        action: Primitive.action(ChannelInstall.definition, "list"),
        resource: Access.organization,
      })
        ? Effect.void
        : Effect.fail(new Primitive.Forbidden({ message: "You cannot see channel installs." }))

    const select = () =>
      database.db
        .select({
          install: table,
          installer: { id: users.id, name: users.name },
          defaultSpace: { id: spaces.id, name: spaces.name },
        })
        .from(table)
        .leftJoin(users, eq(users.id, table.installed_by))
        .leftJoin(spaces, and(eq(spaces.id, table.default_space_id), isNull(spaces.archived_at)))

    const held = Effect.fnUntraced(function* (
      actor: Actor.Info,
      id: ChannelInstall.ID,
      operation: "update" | "remove",
    ) {
      yield* allowed(actor)
      if (!Schema.is(ChannelInstall.ID)(id)) return yield* notFound
      const found = (yield* select()
        .where(and(eq(table.id, id), eq(table.organization_id, actor.organizationId)))
        .pipe(Effect.orDie)).at(0)
      if (!found) return yield* notFound
      if (
        !access.isAllowed({
          actor,
          action: Primitive.action(ChannelInstall.definition, operation),
          resource: ChannelInstallPolicy.resource(found.install.installed_by === actor.userId),
        })
      )
        return yield* new Primitive.Forbidden({
          message: `Only the person who installed ${Channel.titles[found.install.provider]}, or an admin, can ${operation === "update" ? "change" : "remove"} it.`,
        })
      return found
    })

    const claim = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      organizationId: Auth.OrganizationID,
      installedBy: Auth.UserID,
      provider: Channel.Provider,
      installed: ChannelProvider.Installed,
    ): Effect.fn.Return<Outcome> {
      const title = Channel.titles[provider]
      const claimed = { ok: true, provider, name: installed.name } satisfies Outcome
      const sealed = (id: ChannelInstall.ID) =>
        installed.secret ? secrets.seal(organizationId, id, installed.secret) : Effect.succeed(null)
      const id = ChannelInstall.ID.create()
      const inserted = yield* transaction
        .insert(table)
        .values({
          id,
          organization_id: organizationId,
          provider,
          workspace: installed.workspace,
          name: installed.name,
          bot_user: installed.botUser ?? null,
          secret: yield* sealed(id),
          installed_by: installedBy,
        })
        .onConflictDoNothing()
        .returning({ id: table.id })
        .pipe(Effect.orDie)
      if (inserted.length > 0) return claimed
      const held = (yield* transaction
        .select({ id: table.id, organizationId: table.organization_id })
        .from(table)
        .where(and(eq(table.provider, provider), eq(table.workspace, installed.workspace)))
        .pipe(Effect.orDie)).at(0)
      if (held && held.organizationId !== organizationId)
        return failed(
          `This ${title} workspace is connected to another organization. Switch to that organization, then try again.`,
        )
      if (held) {
        const updated = yield* transaction
          .update(table)
          .set({ name: installed.name, bot_user: installed.botUser ?? null, secret: yield* sealed(held.id) })
          .where(and(eq(table.id, held.id), eq(table.organization_id, organizationId)))
          .returning({ id: table.id })
          .pipe(Effect.orDie)
        return updated.length > 0
          ? claimed
          : yield* claim(transaction, organizationId, installedBy, provider, installed)
      }
      const other = (yield* transaction
        .select({ name: table.name })
        .from(table)
        .where(and(eq(table.organization_id, organizationId), eq(table.provider, provider)))
        .pipe(Effect.orDie)).at(0)
      if (!other) return yield* claim(transaction, organizationId, installedBy, provider, installed)
      return failed(`This organization already has ${title} connected: ${other.name}.`)
    })

    const link = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      row: typeof states.$inferSelect,
      provider: Channel.Provider,
      installer: NonNullable<ChannelProvider.Installed["installer"]>,
    ) {
      const now = new Date(yield* Clock.currentTimeMillis)
      yield* transaction
        .insert(Database.Schema.account)
        .values({
          id: Auth.AccountID.create(),
          providerId: provider,
          accountId: installer.accountId,
          userId: row.initiator_user_id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
      const linked = (yield* transaction
        .select({ userId: Database.Schema.account.userId })
        .from(Database.Schema.account)
        .where(
          and(
            eq(Database.Schema.account.providerId, provider),
            eq(Database.Schema.account.accountId, installer.accountId),
          ),
        )
        .pipe(Effect.orDie)).at(0)
      if (linked?.userId !== row.initiator_user_id)
        return yield* new ChannelProvider.InstallFailed({
          message: `This ${Channel.titles[provider]} account is linked to another Ren account. Sign in to that Ren account to connect it.`,
        })
    })

    return Service.of({
      providers: Effect.succeed({
        items: registry.providers.map((provider) => ({
          id: provider.id,
          title: Channel.titles[provider.id],
          triggers: provider.triggers,
        })),
      }),

      list: Effect.fn("ChannelInstalls.list")(function* (actor: Actor.Info, input: ChannelInstall.ListInput) {
        yield* allowed(actor).pipe(Effect.orDie)
        const where = eq(table.organization_id, actor.organizationId)
        const rows = yield* select()
          .where(where)
          .orderBy(asc(table.provider))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize)
          .pipe(Effect.orDie)
        const totals = yield* database.db.select({ total: count() }).from(table).where(where).pipe(Effect.orDie)
        return {
          items: rows.map(toInfo(actor)),
          page: input.page,
          pageSize: input.pageSize,
          total: totals.at(0)?.total ?? 0,
        }
      }),

      start: Effect.fn("ChannelInstalls.start")(function* (actor: Actor.Info, input: ChannelInstall.StartInput) {
        yield* allowed(actor)
        const title = Channel.titles[input.provider]
        const provider = registry.get(input.provider)
        if (Option.isNone(provider))
          return yield* new Primitive.Invalid({
            message: `${title} is not set up on this Ren server.`,
            field: "provider",
          })
        const state = Random.token(32)
        const expiresAt = new Date((yield* Clock.currentTimeMillis) + ChannelInstall.stateLifetimeMinutes * 60_000)
        yield* database.db
          .insert(states)
          .values({
            state,
            organization_id: actor.organizationId,
            provider: input.provider,
            initiator_user_id: actor.userId,
            expires_at: expiresAt,
          })
          .pipe(Effect.orDie)
        return {
          redirectUrl: provider.value.installUrl(state, yield* accountsOf(actor.userId, input.provider)),
          expiresAt: DateTime.fromDateUnsafe(expiresAt),
        }
      }),

      complete: Effect.fn("ChannelInstalls.complete")(function* (
        id: string,
        query: Readonly<Record<string, string>>,
        browser: Option.Option<Auth.UserID>,
      ) {
        const provider = registry.get(id)
        if (Option.isNone(provider)) return failed("This provider is not set up on this Ren server.")
        const state = query.state
        if (!state)
          return provider.value.changedOnProvider(query)
            ? ({ ok: true, provider: provider.value.id, name: null } satisfies Outcome)
            : failed("The address has no install state. Start the install from Ren: Settings → Channels.")
        const now = yield* Clock.currentTimeMillis
        const row = (yield* database.db
          .update(states)
          .set({ consumed_at: new Date(now) })
          .where(and(eq(states.state, state), eq(states.provider, provider.value.id), isNull(states.consumed_at)))
          .returning()
          .pipe(Effect.orDie)).at(0)
        if (!row) return failed("This install link was already used, or Ren did not make it. Start the install again.")
        if (row.expires_at.getTime() <= now) return failed("This install link expired. Start the install again.")
        if (Option.isSome(browser) && browser.value !== row.initiator_user_id)
          return failed("You are signed in to Ren as someone other than the person who started this install.")
        const member = yield* database
          .transaction((transaction) =>
            SpaceQueries.organizationMember(transaction, row.organization_id, row.initiator_user_id),
          )
          .pipe(Effect.orDie)
        if (!member) return failed("You are no longer a member of the organization that started this install.")
        const installed = yield* Effect.result(
          provider.value.completeInstall(query, yield* accountsOf(row.initiator_user_id, provider.value.id)),
        )
        if (installed._tag === "Failure") return failed(installed.failure.message)
        const installer = installed.success.installer
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const outcome = yield* claim(
                transaction,
                row.organization_id,
                row.initiator_user_id,
                provider.value.id,
                installed.success,
              )
              if (outcome.ok && installer) yield* link(transaction, row, provider.value.id, installer)
              return outcome
            }),
          )
          .pipe(
            Effect.tap(
              Effect.fnUntraced(function* (outcome) {
                if (outcome.ok && installer?.credential)
                  yield* people.save(row.organization_id, row.initiator_user_id, installer.credential)
              }),
            ),
            Effect.catchTag("ChannelProvider.InstallFailed", (error) => Effect.succeed(failed(error.message))),
          )
      }),

      update: Effect.fn("ChannelInstalls.update")(function* (
        actor: Actor.Info,
        id: ChannelInstall.ID,
        input: ChannelInstall.UpdateInput,
      ) {
        const found = yield* held(actor, id, "update")
        const defaultSpaceId = input.defaultSpaceId
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            if (
              defaultSpaceId &&
              (yield* transaction
                .select({ id: spaces.id })
                .from(spaces)
                .where(
                  and(
                    eq(spaces.id, defaultSpaceId),
                    eq(spaces.organization_id, actor.organizationId),
                    isNull(spaces.archived_at),
                  ),
                )
                .for("share")).length === 0
            )
              return yield* new Primitive.Invalid({ message: "Space not found.", field: "defaultSpaceId" })
            if (
              defaultSpaceId &&
              !(yield* SpaceQueries.actsIn(transaction, access, actor.organizationId, defaultSpaceId, actor.userId))
            )
              return yield* new Primitive.Invalid({
                message: "Choose a space you are a member of.",
                field: "defaultSpaceId",
              })
            yield* transaction
              .update(table)
              .set({ default_space_id: defaultSpaceId })
              .where(eq(table.id, found.install.id))
          }),
        )
        const updated = (yield* select().where(eq(table.id, found.install.id)).pipe(Effect.orDie)).at(0)
        if (!updated) return yield* notFound
        return toInfo(actor)(updated)
      }),

      remove: Effect.fn("ChannelInstalls.remove")(function* (actor: Actor.Info, id: ChannelInstall.ID) {
        const found = yield* held(actor, id, "remove")
        yield* Option.match(registry.get(found.install.provider), {
          onNone: () => Effect.void,
          onSome: (provider) =>
            provider
              .revoke(found.install.workspace)
              .pipe(
                Effect.catchTag("ChannelProvider.Unavailable", (error) =>
                  Effect.logWarning(`The provider did not revoke install ${id}; Ren removed it`, error),
                ),
              ),
        })
        yield* database.db.delete(table).where(eq(table.id, id)).pipe(Effect.orDie)
        return toInfo(actor)(found)
      }),

      removeByWorkspace: Effect.fn("ChannelInstalls.removeByWorkspace")(function* (
        provider: Channel.Provider,
        workspace: string,
      ) {
        yield* database.db
          .delete(table)
          .where(and(eq(table.provider, provider), eq(table.workspace, workspace)))
          .pipe(Effect.orDie)
      }),
    })
  }),
)
