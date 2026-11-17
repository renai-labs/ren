export * as AccountDeletion from "./account-deletion.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Mailer } from "./mailer.js"

export interface User {
  readonly id: Auth.UserID
  readonly email: string
}

export class SoleOwner extends Schema.TaggedError<SoleOwner>()("AccountDeletion.SoleOwner", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly request: (user: User) => Effect.Effect<void, SoleOwner>
  readonly isArchived: (userId: Auth.UserID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/AccountDeletion") {}

export const support = "support@renai.build"

export const email = (to: string): Mailer.Email => ({
  to,
  subject: "We’ve received your request to delete your Ren account",
  text: `We’ve received your request to delete your Ren account. You’re signed out everywhere and can’t sign in again. We’ll delete your account and its data within 7 days, and we’ll email you again when it’s done. If you didn’t ask for this, contact ${support}.`,
})

const isOwner = (role: string) => Auth.roles(role).includes("owner")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const mailer = yield* Mailer.Service
    return Service.of({
      request: Effect.fn("AccountDeletion.request")(function* (user: User) {
        const archived = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const members = yield* transaction
              .select({
                organizationId: Database.Schema.member.organizationId,
                organization: Database.Schema.organization.name,
                userId: Database.Schema.member.userId,
                role: Database.Schema.member.role,
              })
              .from(Database.Schema.member)
              .innerJoin(
                Database.Schema.organization,
                eq(Database.Schema.organization.id, Database.Schema.member.organizationId),
              )
              .where(
                inArray(
                  Database.Schema.member.organizationId,
                  transaction
                    .select({ id: Database.Schema.member.organizationId })
                    .from(Database.Schema.member)
                    .where(eq(Database.Schema.member.userId, user.id)),
                ),
              )
            const stranded = members.filter(
              (member) =>
                member.userId === user.id &&
                isOwner(member.role) &&
                members.some((other) => other.organizationId === member.organizationId && other.userId !== user.id) &&
                !members.some(
                  (other) =>
                    other.organizationId === member.organizationId && other.userId !== user.id && isOwner(other.role),
                ),
            )
            if (stranded.length > 0) {
              return yield* new SoleOwner({
                message: `You’re the only owner of ${stranded.map((member) => member.organization).join(", ")}. Make another member an owner before you delete your account, or contact ${support}.`,
              })
            }
            const inserted = yield* transaction
              .insert(Database.Schema.account_deletion)
              .values({ user_id: user.id })
              .onConflictDoNothing()
              .returning()
            yield* transaction.delete(Database.Schema.session).where(eq(Database.Schema.session.userId, user.id))
            yield* transaction
              .delete(Database.Schema.oauthRefreshToken)
              .where(eq(Database.Schema.oauthRefreshToken.userId, user.id))
            yield* transaction
              .delete(Database.Schema.oauthAccessToken)
              .where(eq(Database.Schema.oauthAccessToken.userId, user.id))
            return inserted.length > 0
          }),
        )
        if (!archived) return
        yield* mailer
          .send(email(user.email))
          .pipe(Effect.ignoreCause({ log: "Error", message: "Failed to send the account deletion email" }))
      }),
      isArchived: Effect.fn("AccountDeletion.isArchived")(function* (userId: Auth.UserID) {
        const rows = yield* database.db
          .select({ userId: Database.Schema.account_deletion.user_id })
          .from(Database.Schema.account_deletion)
          .where(eq(Database.Schema.account_deletion.user_id, userId))
        return rows.length > 0
      }, Effect.orDie),
    })
  }),
)
