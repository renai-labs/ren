import { describe, expect } from "bun:test"
import { AuthDatabase } from "@ren/db/auth-database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Effect, Layer } from "effect"
import { Invitation } from "../src/invitation.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Invitation.layer.pipe(Layer.provideMerge(Testing.layer)))

const seed = Effect.fnUntraced(function* (
  invitation: { status?: string; expiresAt?: Date; email?: string } = {},
  inviterName = "Ingrid Inviter",
) {
  const database = yield* AuthDatabase.Service
  const organization = Auth.OrganizationID.create()
  const inviter = Auth.UserID.create()
  const id = Auth.InvitationID.create()
  yield* Effect.promise(async () => {
    await database.db.insert(AuthDatabase.Schema.organization).values({
      id: organization,
      name: "Northstar Labs",
      slug: `northstar-${organization.toLowerCase()}`,
      logo: "https://example.com/northstar.png",
      createdAt: new Date(),
    })
    await database.db.insert(AuthDatabase.Schema.user).values({
      id: inviter,
      name: inviterName,
      email: `${inviter.toLowerCase()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await database.db.insert(AuthDatabase.Schema.invitation).values({
      id,
      organizationId: organization,
      inviterId: inviter,
      email: invitation.email ?? "invitee@example.com",
      role: "member",
      status: invitation.status ?? "pending",
      expiresAt: invitation.expiresAt ?? new Date(Date.now() + 60_000),
      createdAt: new Date(),
    })
  })
  return { id, organization, inviter }
})

describe("Invitation.preview", () => {
  it.live("returns the organization and inviter of a pending invitation", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      const seeded = yield* seed()
      expect(yield* invitations.preview(seeded.id)).toEqual({
        state: "pending",
        organization: { id: seeded.organization, name: "Northstar Labs", logo: "https://example.com/northstar.png" },
        inviter: { name: "Ingrid Inviter", email: `${seeded.inviter.toLowerCase()}@example.com` },
      })
    }),
  )

  it.live("does not expose the invited email address", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      const seeded = yield* seed({ email: "secret.invitee@example.com" })
      expect(JSON.stringify(yield* invitations.preview(seeded.id))).not.toContain("secret.invitee")
    }),
  )

  it.live("identifies expired and accepted invitations", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      const expired = yield* seed({ expiresAt: new Date(Date.now() - 60_000) })
      const accepted = yield* seed({ status: "accepted" })
      expect((yield* invitations.preview(expired.id)).state).toBe("expired")
      expect((yield* invitations.preview(accepted.id)).state).toBe("accepted")
    }),
  )

  it.live("treats canceled, rejected and unknown statuses as unavailable", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      for (const status of ["canceled", "rejected", "some-future-status"]) {
        expect((yield* invitations.preview((yield* seed({ status })).id)).state).toBe("unavailable")
      }
    }),
  )

  it.live("returns a blank inviter name as null", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      expect((yield* invitations.preview((yield* seed({}, "  ")).id)).inviter?.name).toBeNull()
    }),
  )

  it.live("returns an invalid state for an unknown invitation", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      expect(yield* invitations.preview("inv_unknown")).toEqual({ state: "invalid", organization: null, inviter: null })
    }),
  )
})
