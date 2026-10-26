export * as ChannelSecrets from "./channel-secrets.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { ChannelInstall } from "@ren/schema/channel-install"
import { and, eq, isNotNull } from "drizzle-orm"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { Envelope } from "./envelope.js"

export interface Found {
  readonly workspace: string
  readonly secret: Redacted.Redacted
}

export interface Interface {
  readonly seal: (
    organizationId: Auth.OrganizationID,
    installId: ChannelInstall.ID,
    secret: Redacted.Redacted,
  ) => Effect.Effect<Envelope.Sealed>
  readonly ofWorkspace: (provider: Channel.Provider, workspace: string) => Effect.Effect<Option.Option<Found>>
  readonly ofOrganization: (
    organizationId: Auth.OrganizationID,
    provider: Channel.Provider,
  ) => Effect.Effect<Option.Option<Found>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelSecrets") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const envelope = yield* Envelope.Service
    const install = Database.Schema.channel_install

    const opened = (
      rows: ReadonlyArray<Pick<typeof install.$inferSelect, "id" | "organization_id" | "workspace" | "secret">>,
    ) =>
      Effect.gen(function* () {
        const row = rows.at(0)
        if (!row?.secret) return Option.none<Found>()
        const secret = yield* envelope
          .open(row.secret, { organizationId: row.organization_id, kind: "channel_install", id: row.id })
          .pipe(Effect.orDie)
        return Option.some<Found>({ workspace: row.workspace, secret })
      })

    const select = () =>
      database.db
        .select({
          id: install.id,
          organization_id: install.organization_id,
          workspace: install.workspace,
          secret: install.secret,
        })
        .from(install)

    return Service.of({
      seal: Effect.fn("ChannelSecrets.seal")(function* (
        organizationId: Auth.OrganizationID,
        installId: ChannelInstall.ID,
        secret: Redacted.Redacted,
      ) {
        return yield* envelope
          .seal(secret, { organizationId, kind: "channel_install", id: installId })
          .pipe(Effect.orDie)
      }),
      ofWorkspace: Effect.fn("ChannelSecrets.ofWorkspace")(function* (provider: Channel.Provider, workspace: string) {
        return yield* opened(
          yield* select()
            .where(and(eq(install.provider, provider), eq(install.workspace, workspace), isNotNull(install.secret)))
            .pipe(Effect.orDie),
        )
      }),
      ofOrganization: Effect.fn("ChannelSecrets.ofOrganization")(function* (
        organizationId: Auth.OrganizationID,
        provider: Channel.Provider,
      ) {
        return yield* opened(
          yield* select()
            .where(
              and(
                eq(install.organization_id, organizationId),
                eq(install.provider, provider),
                isNotNull(install.secret),
              ),
            )
            .pipe(Effect.orDie),
        )
      }),
    })
  }),
)
