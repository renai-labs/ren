import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(
  Layer.mergeAll(Space.layer, SpaceMember.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

const page = { page: 1, pageSize: 50 }

const organization = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const id = Auth.OrganizationID.create()
  yield* database.db
    .insert(Database.Schema.organization)
    .values({ id, name: "Northstar", slug: id.toLowerCase(), createdAt: new Date() })
  return id
})

const user = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role = "member") {
  const database = yield* Database.Service
  const provisioning = yield* SpaceProvisioning.Service
  const id = Auth.UserID.create()
  const email = `${id.toLowerCase()}@example.com`
  yield* database.db
    .insert(Database.Schema.user)
    .values({ id, name: "Ada", email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
  yield* database.db
    .insert(Database.Schema.member)
    .values({ id: Auth.MemberID.create(), organizationId, userId: id, role, createdAt: new Date() })
  yield* provisioning.createInitialMemberships(organizationId, { id, name: "Ada", email })
  return { userId: id, organizationId, roles: [role], email }
})

const invite = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  inviterId: Auth.UserID,
  email: string,
  invitation: { readonly status: string; readonly expiresAt: Date },
) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.invitation).values({
    id: Auth.InvitationID.create(),
    organizationId,
    inviterId,
    email,
    role: "member",
    createdAt: new Date(),
    ...invitation,
  })
})

describe("Space", () => {
  it.live("provisions one shared first space and a personal space per member", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const organizationId = yield* organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const names = (yield* spaces.list(ada, page)).items.map((space) => space.name)
      expect(names).toEqual(["General Space", "Ada's Personal Space"])
      const general = (yield* spaces.list(grace, page)).items.at(0)
      expect(general?.name).toBe("General Space")
      expect(general?.memberCount).toBe(2)
    }),
  )

  it.live("hides spaces from organization members outside them and lets admins manage without joining", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const organizationId = yield* organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const admin = yield* user(organizationId, "admin")
      const team = yield* spaces.create(ada, { name: "Team" })
      expect(team).toMatchObject({ canUpdate: true, canAddMember: true, canRemoveMember: true, canArchive: true })
      expect(yield* spaces.get(admin, team.id)).toMatchObject({
        membershipId: null,
        canUpdate: true,
        canAddMember: true,
        canRemoveMember: true,
        canArchive: true,
      })
      expect((yield* Effect.flip(spaces.get(grace, team.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* spaces.list(grace, page)).items.map((space) => space.id)).not.toContain(team.id)
      const managed = yield* spaces.update(admin, team.id, { description: "Shared" })
      expect(managed.membershipId).toBeNull()
      expect(managed.description).toBe("Shared")
      expect((yield* spaces.list(admin, { ...page, joined: true })).items.map((space) => space.id)).not.toContain(
        team.id,
      )
    }),
  )

  it.live("protects the first organization space from archiving and makes archive retries idempotent", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const organizationId = yield* organization()
      const ada = yield* user(organizationId)
      const owner = yield* user(organizationId, "owner")
      const general = (yield* spaces.list(ada, page)).items.at(0)
      if (!general) return yield* Effect.die(new Error("Expected a general space"))
      expect(general.canArchive).toBe(false)
      expect((yield* Effect.flip(spaces.archive(ada, general.id)))._tag).toBe("Primitive.Forbidden")
      expect((yield* spaces.get(owner, general.id)).canArchive).toBe(false)
      expect(yield* Effect.flip(spaces.archive(owner, general.id))).toMatchObject({
        _tag: "Primitive.Forbidden",
        message: "This space cannot be archived.",
      })
      const team = yield* spaces.create(ada, { name: "Team" })
      const archived = yield* spaces.archive(ada, team.id)
      expect(archived.archivedAt).not.toBeNull()
      expect(yield* spaces.archive(ada, team.id)).toEqual(archived)
      expect((yield* Effect.flip(spaces.get(ada, team.id)))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("hides spaces from non-members and other organizations on every operation", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const members = yield* SpaceMember.Service
      const organizationId = yield* organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const outsider = yield* user(yield* organization(), "owner")
      const team = yield* spaces.create(ada, { name: "Team" })
      const added = yield* members.create(ada, { spaceId: team.id, userId: grace.userId })
      yield* members.archive(ada, added.id)
      const withoutOrganizationRole = { userId: outsider.userId, organizationId, roles: [] }
      expect(yield* Effect.flip(spaces.create(withoutOrganizationRole, { name: "Intruder" }))).toMatchObject({
        _tag: "Primitive.Forbidden",
        message: "Join the organization to create spaces.",
      })
      expect((yield* spaces.list(withoutOrganizationRole, page)).items).toEqual([])
      const hidden = [grace, outsider].flatMap((actor): Effect.Effect<unknown, { readonly _tag: string }>[] => [
        spaces.get(actor, team.id),
        spaces.update(actor, team.id, { name: "Taken" }),
        spaces.archive(actor, team.id),
        members.create(actor, { spaceId: team.id, userId: actor.userId }),
        members.archive(actor, added.id),
      ])
      const failures = yield* Effect.forEach(hidden, (operation) => Effect.flip(operation))
      expect(failures.map((failure) => failure._tag)).toEqual(hidden.map(() => "Primitive.NotFound"))
      for (const actor of [grace, outsider]) {
        expect(yield* members.list(actor, { ...page, spaceId: team.id })).toEqual({ ...page, items: [], total: 0 })
      }
      expect((yield* spaces.list(outsider, page)).items.map((space) => space.id)).not.toContain(team.id)
    }),
  )

  it.live("rejects updates to archived spaces and new members in them, but repeats the archive", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const members = yield* SpaceMember.Service
      const organizationId = yield* organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const admin = yield* user(organizationId, "admin")
      const team = yield* spaces.create(ada, { name: "Team" })
      const archived = yield* spaces.archive(ada, team.id)
      expect(yield* spaces.archive(admin, team.id)).toMatchObject({ id: team.id, archivedAt: archived.archivedAt })
      for (const actor of [ada, admin]) {
        expect((yield* Effect.flip(spaces.update(actor, team.id, { name: "Late" })))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(members.create(actor, { spaceId: team.id, userId: grace.userId })))._tag).toBe(
          "Primitive.NotFound",
        )
      }
    }),
  )
})

describe("SpaceMember", () => {
  it.live("adds only current organization members, once, and lets any member remove anyone including themselves", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const members = yield* SpaceMember.Service
      const organizationId = yield* organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const outsider = yield* user(yield* organization())
      const team = yield* spaces.create(ada, { name: "Team" })
      expect((yield* Effect.flip(members.create(ada, { spaceId: team.id, userId: outsider.userId })))._tag).toBe(
        "Primitive.Conflict",
      )
      const added = yield* members.create(ada, { spaceId: team.id, userId: grace.userId })
      expect(yield* Effect.flip(members.create(ada, { spaceId: team.id, userId: grace.userId }))).toMatchObject({
        _tag: "Primitive.Conflict",
        message: "The user is already a member of this space.",
      })
      const creator = (yield* members.list(grace, { ...page, spaceId: team.id })).items.at(0)
      if (!creator) return yield* Effect.die(new Error("Expected the space creator"))
      const removed = yield* members.archive(grace, creator.id)
      expect(yield* members.archive(grace, creator.id)).toEqual(removed)
      expect((yield* members.archive(grace, added.id)).archivedAt).not.toBeNull()
      expect((yield* members.list(grace, { ...page, spaceId: team.id })).total).toBe(0)
    }),
  )

  it.live(
    "requires a pending organization invitation for email assignments, which grant no access until accepted",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const members = yield* SpaceMember.Service
        const provisioning = yield* SpaceProvisioning.Service
        const database = yield* Database.Service
        const organizationId = yield* organization()
        const ada = yield* user(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        yield* invite(organizationId, ada.userId, "canceled@example.com", {
          status: "canceled",
          expiresAt: new Date(Date.now() + 60_000),
        })
        yield* invite(organizationId, ada.userId, "late@example.com", {
          status: "pending",
          expiresAt: new Date(Date.now() - 60_000),
        })
        expect(
          (yield* Effect.flip(members.create(ada, { spaceId: team.id, email: "canceled@example.com" })))._tag,
        ).toBe("Primitive.Conflict")
        const assignment = yield* members.create(ada, { spaceId: team.id, email: " Late@Example.com " })
        expect(assignment).toMatchObject({ status: "pending", email: "late@example.com" })
        const duplicate = yield* Effect.flip(members.create(ada, { spaceId: team.id, email: "late@example.com" }))
        expect(duplicate).toMatchObject({
          _tag: "Primitive.Conflict",
          message: "This email is already pending in this space.",
        })
        expect((yield* spaces.get(ada, team.id)).memberCount).toBe(1)
        const pendingOnly = yield* members.list(ada, { ...page, spaceId: team.id, status: "pending" })
        expect(pendingOnly.items.map((member) => member.id)).toEqual([assignment.id])
        expect((yield* members.list(ada, { ...page, spaceId: team.id })).total).toBe(2)

        const late = Auth.UserID.create()
        yield* database.db.insert(Database.Schema.user).values({
          id: late,
          name: "Late",
          email: "late@example.com",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        yield* database.db.insert(Database.Schema.member).values({
          id: Auth.MemberID.create(),
          organizationId,
          userId: late,
          role: "member",
          createdAt: new Date(),
        })
        yield* provisioning.activatePendingMemberships(organizationId, {
          id: late,
          name: "Late",
          email: "late@example.com",
        })
        const statuses = (yield* members.list(ada, { ...page, spaceId: team.id })).items.map((member) => member.status)
        expect(statuses).toEqual(["active", "active"])
        expect((yield* spaces.get({ userId: late, organizationId, roles: ["member"] }, team.id)).memberCount).toBe(2)
      }),
  )

  it.live("revokes access on organization departure and does not restore it on rejoin", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const provisioning = yield* SpaceProvisioning.Service
      const database = yield* Database.Service
      const organizationId = yield* organization()
      const ada = yield* user(organizationId)
      const team = yield* spaces.create(ada, { name: "Team" })
      yield* database.db
        .delete(Database.Schema.member)
        .where(
          and(eq(Database.Schema.member.organizationId, organizationId), eq(Database.Schema.member.userId, ada.userId)),
        )
      yield* provisioning.archiveMemberships(organizationId, ada.userId)
      yield* database.db.insert(Database.Schema.member).values({
        id: Auth.MemberID.create(),
        organizationId,
        userId: ada.userId,
        role: "member",
        createdAt: new Date(),
      })
      yield* provisioning.createInitialMemberships(organizationId, { id: ada.userId, name: "Ada", email: ada.email })
      const names = (yield* spaces.list(ada, page)).items.map((space) => space.name)
      expect(names).toEqual(["General Space", "Ada's Personal Space"])
      expect((yield* Effect.flip(spaces.get(ada, team.id)))._tag).toBe("Primitive.NotFound")
    }),
  )
})
