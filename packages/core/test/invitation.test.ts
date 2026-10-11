import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Effect, Layer } from "effect"
import { Invitation } from "../src/invitation.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Invitation.layer.pipe(Layer.provideMerge(Testing.layer)))

const seed = Effect.fnUntraced(function* (invitation: { status?: string; expiresAt?: Date }) {
  const database = yield* Database.Service
  const organization = Auth.OrganizationID.create()
  const inviter = Auth.UserID.create()
  const id = Auth.InvitationID.create()
  yield* database.db.insert(Database.Schema.organization).values({
    id: organization,
    name: "Northstar Labs",
    slug: `northstar-${organization.toLowerCase()}`,
    createdAt: new Date(),
  })
  yield* database.db.insert(Database.Schema.user).values({
    id: inviter,
    name: "Ingrid Inviter",
    email: `${inviter.toLowerCase()}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  yield* database.db.insert(Database.Schema.invitation).values({
    id,
    organizationId: organization,
    inviterId: inviter,
    email: "invitee@example.com",
    role: "member",
    status: invitation.status ?? "pending",
    expiresAt: invitation.expiresAt ?? new Date(Date.now() + 60_000),
    createdAt: new Date(),
  })
  return id
})

describe("Invitation.preview", () => {
  it.live("identifies expired and accepted invitations", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      const expired = yield* seed({ expiresAt: new Date(Date.now() - 60_000) })
      const accepted = yield* seed({ status: "accepted" })
      expect((yield* invitations.preview(expired)).state).toBe("expired")
      expect((yield* invitations.preview(accepted)).state).toBe("accepted")
    }),
  )

  it.live("treats canceled, rejected and unknown statuses as unavailable", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      const previews = yield* Effect.forEach(["canceled", "rejected", "some-future-status"], (status) =>
        Effect.flatMap(seed({ status }), invitations.preview),
      )
      expect(previews.map((preview) => preview.state)).toEqual(["unavailable", "unavailable", "unavailable"])
    }),
  )

  it.live("returns an invalid state for an unknown invitation", () =>
    Effect.gen(function* () {
      const invitations = yield* Invitation.Service
      expect(yield* invitations.preview("inv_unknown")).toEqual({ state: "invalid", organization: null, inviter: null })
    }),
  )
})
