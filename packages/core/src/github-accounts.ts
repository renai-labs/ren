export * as GitHubAccounts from "./github-accounts.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { and, eq, isNotNull } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Option, Redacted } from "effect"
import { GitHubApp } from "./github-app.js"
import { PersonCredentials } from "./person-credentials.js"

export interface Interface {
  readonly signIn: Option.Option<{ readonly clientId: string; readonly clientSecret: Redacted.Redacted }>
  readonly sync: (userId: Auth.UserID) => Effect.Effect<void, GitHubApp.Failed>
  readonly disconnect: (userId: Auth.UserID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/GitHubAccounts") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({ signIn: Option.none(), sync: () => Effect.void, disconnect: () => Effect.void }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const github = yield* GitHubApp.Service
    const people = yield* PersonCredentials.Service
    const account = Database.Schema.account
    return Service.of({
      signIn: Option.map(github.client, (client) => ({
        clientId: client.settings.clientId,
        clientSecret: client.settings.clientSecret,
      })),
      disconnect: Effect.fn("GitHubAccounts.disconnect")(function* (userId: Auth.UserID) {
        const left = yield* database.db
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, userId), eq(account.providerId, "github")))
          .pipe(Effect.orDie)
        if (left.length === 0) yield* people.remove(userId, GitHubApp.label)
      }),
      sync: Effect.fn("GitHubAccounts.sync")(function* (userId: Auth.UserID) {
        if (Option.isNone(github.client)) return
        const client = github.client.value
        const signedIn = yield* database.db
          .select()
          .from(account)
          .where(and(eq(account.userId, userId), eq(account.providerId, "github"), isNotNull(account.accessToken)))
          .pipe(Effect.orDie)
        if (signedIn.length === 0) return
        const organizations = yield* database.db
          .select({ id: Database.Schema.member.organizationId })
          .from(Database.Schema.member)
          .where(eq(Database.Schema.member.userId, userId))
          .pipe(Effect.orDie)
        if (organizations.length === 0) return
        const now = yield* Clock.currentTimeMillis
        yield* Effect.forEach(
          signedIn,
          Effect.fnUntraced(function* (row) {
            if (!row.accessToken) return
            const accessToken = Redacted.make(row.accessToken)
            const user = yield* client.user(accessToken)
            const expiresIn = row.accessTokenExpiresAt && Math.floor((row.accessTokenExpiresAt.getTime() - now) / 1000)
            const credential = GitHubApp.personCredential(
              client.settings,
              user,
              {
                accessToken,
                ...(row.refreshToken && { refreshToken: Redacted.make(row.refreshToken) }),
                ...(expiresIn && expiresIn > 0 && { expiresIn }),
              },
              now,
            )
            yield* Effect.forEach(
              organizations,
              (organization) => people.save(Auth.OrganizationID.make(organization.id), userId, credential),
              { discard: true },
            )
            yield* database.db
              .update(account)
              .set({ accessToken: null, refreshToken: null })
              .where(eq(account.id, row.id))
              .pipe(Effect.orDie)
          }),
          { discard: true },
        )
      }),
    })
  }),
)
