import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Agent } from "@ren/schema/agent"
import { Auth } from "@ren/schema/auth"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import { Schedule } from "@ren/schema/schedule"
import { Session } from "@ren/schema/session"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(Space.layer, SpaceMember.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
    Layer.provideMerge(Testing.layer),
  ),
)

const page = { page: 1, pageSize: 50 }

const user = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role = "member") {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role], email: seeded.email }
})

describe("Space", () => {
  it.live("provisions one shared first space and a personal space per member", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const names = (yield* spaces.list(ada, page)).items.map((space) => space.name)
      expect(names).toEqual(["General Space", "Ada's Personal Space"])
      expect((yield* spaces.list(ada, page)).items.map((space) => space.kind)).toEqual(["shared", "private"])
      const general = (yield* spaces.list(grace, page)).items.at(0)
      expect(general?.name).toBe("General Space")
      expect(general?.memberCount).toBe(2)
    }),
  )

  it.live(
    "hides spaces from members outside them; an admin sees the list entry and joins before changing anything (AC4)",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const members = yield* SpaceMember.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* user(organizationId)
        const grace = yield* user(organizationId)
        const admin = yield* user(organizationId, "admin")
        const team = yield* spaces.create(ada, { name: "Team", description: "Shared" })
        expect(team).toMatchObject({ canUpdate: true, canAddMember: true, canRemoveMember: true, canArchive: true })
        expect(yield* spaces.get(admin, team.id)).toMatchObject({
          membershipId: null,
          description: "Shared",
          canJoin: true,
          canUpdate: false,
          canAddMember: false,
          canArchive: false,
        })
        expect((yield* Effect.flip(spaces.get(grace, team.id)))._tag).toBe("Primitive.NotFound")
        expect((yield* spaces.list(grace, page)).items.map((space) => space.id)).not.toContain(team.id)
        expect((yield* Effect.flip(spaces.update(admin, team.id, { description: "Mine" })))._tag).toBe(
          "Primitive.Forbidden",
        )
        expect((yield* Effect.flip(members.create(admin, { spaceId: team.id, userId: grace.userId })))._tag).toBe(
          "Primitive.Forbidden",
        )
        yield* members.create(admin, { spaceId: team.id, userId: admin.userId })
        expect((yield* spaces.update(admin, team.id, { description: "Joined" })).description).toBe("Joined")
        expect((yield* spaces.get(ada, team.id)).memberCount).toBe(2)
      }),
  )

  it.live(
    "a private space is its owner's alone: one per person, no member joins, an admin sees its list entry and archives it (private-spaces tests 1, 2, 4)",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const spaces = yield* Space.Service
        const members = yield* SpaceMember.Service
        const provisioning = yield* SpaceProvisioning.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* user(organizationId)
        const grace = yield* user(organizationId)
        const admin = yield* user(organizationId, "admin")
        const own = (yield* spaces.list(ada, page)).items.find((space) => space.kind === "private")
        expect(own).toMatchObject({ ownerUserId: ada.userId, canAddMember: false, canArchive: false, canJoin: false })
        if (!own) return yield* Effect.die(new Error("expected Ada's private space"))
        yield* provisioning.createInitialMemberships(organizationId, { id: ada.userId, name: "Ada", email: ada.email })
        expect((yield* spaces.list(ada, page)).items.filter((space) => space.kind === "private")).toHaveLength(1)
        const two = yield* spaces.create(ada, { name: "Two" })
        const second = yield* Effect.exit(
          database.db
            .update(Database.Schema.space)
            .set({ kind: "private", owner_user_id: ada.userId })
            .where(eq(Database.Schema.space.id, two.id)),
        )
        expect(second._tag).toBe("Failure")
        expect((yield* Effect.flip(members.create(ada, { spaceId: own.id, userId: grace.userId })))._tag).toBe(
          "Primitive.Forbidden",
        )
        expect((yield* Effect.flip(members.create(admin, { spaceId: own.id, userId: admin.userId })))._tag).toBe(
          "Primitive.Forbidden",
        )
        const membership = (yield* members.list(ada, { spaceId: own.id, ...page })).items.at(0)
        if (!membership) return yield* Effect.die(new Error("expected Ada's membership"))
        expect((yield* Effect.flip(members.archive(ada, membership.id)))._tag).toBe("Primitive.Forbidden")
        expect((yield* Effect.flip(spaces.archive(ada, own.id)))._tag).toBe("Primitive.Forbidden")
        expect(yield* spaces.get(admin, own.id)).toMatchObject({
          name: own.name,
          ownerUserId: ada.userId,
          description: null,
          canJoin: false,
          canUpdate: false,
          canArchive: true,
        })
        expect((yield* members.list(admin, { spaceId: own.id, ...page })).items).toEqual([])
        expect((yield* Effect.flip(spaces.get(grace, own.id)))._tag).toBe("Primitive.NotFound")
        expect((yield* spaces.archive(admin, own.id)).archivedAt).not.toBeNull()
      }),
  )

  it.live("a person who leaves the org loses their private space (private-spaces rule 16)", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const provisioning = yield* SpaceProvisioning.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const admin = yield* user(organizationId, "admin")
      const own = (yield* spaces.list(ada, page)).items.find((space) => space.kind === "private")
      if (!own) return yield* Effect.die(new Error("expected Ada's private space"))
      yield* provisioning.archiveMemberships(organizationId, ada.userId)
      expect((yield* Effect.flip(spaces.get(admin, own.id)))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("protects the first organization space from archiving and makes archive retries idempotent", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const organizationId = yield* Seed.organization()
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
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const outsider = yield* user(yield* Seed.organization(), "owner")
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

  it.live("rejects updates to archived spaces and new members in them", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const members = yield* SpaceMember.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const admin = yield* user(organizationId, "admin")
      const team = yield* spaces.create(ada, { name: "Team" })
      yield* spaces.archive(ada, team.id)
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
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const grace = yield* user(organizationId)
      const outsider = yield* user(yield* Seed.organization())
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
        const organizationId = yield* Seed.organization()
        const ada = yield* user(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        yield* Seed.invitation({
          organizationId,
          inviterId: ada.userId,
          email: "canceled@example.com",
          status: "canceled",
        })
        yield* Seed.invitation({
          organizationId,
          inviterId: ada.userId,
          email: "late@example.com",
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

        const late = yield* Seed.user({ name: "Late", email: "late@example.com" })
        yield* Seed.member(organizationId, late.id, "member")
        yield* provisioning.activatePendingMemberships(organizationId, late)
        const statuses = (yield* members.list(ada, { ...page, spaceId: team.id })).items.map((member) => member.status)
        expect(statuses).toEqual(["active", "active"])
        expect((yield* spaces.get({ userId: late.id, organizationId, roles: ["member"] }, team.id)).memberCount).toBe(2)
      }),
  )

  it.live("revokes access on organization departure and does not restore it on rejoin", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const provisioning = yield* SpaceProvisioning.Service
      const database = yield* Database.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const team = yield* spaces.create(ada, { name: "Team" })
      yield* database.db
        .delete(Database.Schema.member)
        .where(
          and(eq(Database.Schema.member.organizationId, organizationId), eq(Database.Schema.member.userId, ada.userId)),
        )
      yield* provisioning.archiveMemberships(organizationId, ada.userId)
      yield* Seed.member(organizationId, ada.userId, "member")
      yield* provisioning.createInitialMemberships(organizationId, { id: ada.userId, name: "Ada", email: ada.email })
      const names = (yield* spaces.list(ada, page)).items.map((space) => space.name)
      expect(names).toEqual(["General Space", "Ada's Personal Space"])
      expect((yield* Effect.flip(spaces.get(ada, team.id)))._tag).toBe("Primitive.NotFound")
    }),
  )
})

describe("Space archive and agents", () => {
  it.live("a space that owns a live agent cannot be archived, and the error names the agents", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const database = yield* Database.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const factory = yield* spaces.create(ada, { name: "Factory" })
      const agentId = Agent.ID.create()
      yield* database.db.insert(Database.Schema.agent).values({
        id: agentId,
        organization_id: organizationId,
        owner_space_id: factory.id,
        name: "build",
        is_subagent: false,
      })
      const refused = yield* Effect.flip(spaces.archive(ada, factory.id))
      expect(refused._tag).toBe("Primitive.Conflict")
      expect(refused.message).toContain("build")
      yield* database.db
        .update(Database.Schema.agent)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent.id, agentId))
      expect((yield* spaces.archive(ada, factory.id)).archivedAt).not.toBeNull()
    }),
  )

  it.live("archiving a space removes the channel mappings to it and archives its schedules (schedules S29)", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const database = yield* Database.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const eng = yield* spaces.create(ada, { name: "Eng" })
      const kept = yield* spaces.create(ada, { name: "Kept" })
      const installId = ChannelInstall.ID.create()
      yield* database.db.insert(Database.Schema.channel_install).values({
        id: installId,
        organization_id: organizationId,
        provider: "github",
        workspace: `${Date.now()}`,
        name: "acme",
      })
      yield* database.db.insert(Database.Schema.channel_mapping).values([
        {
          id: ChannelMapping.ID.create(),
          install_id: installId,
          place: "8812",
          place_name: "acme/api",
          space_id: eng.id,
        },
        {
          id: ChannelMapping.ID.create(),
          install_id: installId,
          place: "8813",
          place_name: "acme/web",
          space_id: kept.id,
        },
      ])
      yield* database.db.insert(Database.Schema.schedule).values(
        [eng.id, kept.id].map((spaceId) => ({
          id: Schedule.ID.create(),
          organization_id: organizationId,
          space_id: spaceId,
          name: "Digest",
          owner_id: ada.userId,
          cron: "0 9 * * *",
          time_zone: "UTC",
          message: "Digest.",
          next_run_at: new Date(Date.now() + 3_600_000),
        })),
      )
      yield* spaces.archive(ada, eng.id)
      expect(
        (yield* database.db.select().from(Database.Schema.channel_mapping)).map((mapping) => mapping.space_id),
      ).toEqual([kept.id])
      expect(
        (yield* database.db
          .select({ spaceId: Database.Schema.schedule.space_id })
          .from(Database.Schema.schedule)
          .where(isNull(Database.Schema.schedule.archived_at))).map((row) => row.spaceId),
      ).toEqual([kept.id])
    }),
  )
})

describe("Space factory order", () => {
  it.live("the order keeps usable agents in order, a read drops the ones no longer usable, and it starts as ren", () =>
    Effect.gen(function* () {
      const spaces = yield* Space.Service
      const database = yield* Database.Service
      yield* Seed.ren()
      const ren = (yield* database.db
        .select({ id: Database.Schema.agent.id })
        .from(Database.Schema.agent)
        .where(and(eq(Database.Schema.agent.name, "ren"), isNull(Database.Schema.agent.organization_id)))).at(0)?.id
      if (!ren) return yield* Effect.die(new Error("The seed wrote no ren agent"))
      const organizationId = yield* Seed.organization()
      const ada = yield* user(organizationId)
      const factory = yield* spaces.create(ada, { name: "Factory" })
      const other = yield* spaces.create(ada, { name: "Other" })
      expect(factory.agentOrder).toEqual([ren])
      const owner = { organizationId, spaceId: factory.id }
      const plan = yield* Seed.agent(owner, "plan", { isSubagent: false })
      const build = yield* Seed.agent(owner, "build", { isSubagent: false })
      const helper = yield* Seed.agent(owner, "helper", { isSubagent: true })
      const elsewhere = yield* Seed.agent({ organizationId, spaceId: other.id }, "elsewhere", { isSubagent: false })
      expect((yield* spaces.get(ada, factory.id)).agentOrder).toEqual([])
      expect((yield* spaces.update(ada, factory.id, { agentOrder: [build, plan, ren] })).agentOrder).toEqual([
        build,
        plan,
        ren,
      ])
      for (const unusable of [elsewhere, helper, "agt_missing", "plan"]) {
        expect((yield* Effect.flip(spaces.update(ada, factory.id, { agentOrder: [unusable] })))._tag).toBe(
          "Primitive.Invalid",
        )
      }
      yield* database.db
        .update(Database.Schema.agent)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent.id, plan))
      expect((yield* spaces.get(ada, factory.id)).agentOrder).toEqual([build, ren])
      const stored = yield* database.db
        .select({ order: Database.Schema.space.agent_order })
        .from(Database.Schema.space)
        .where(eq(Database.Schema.space.id, factory.id))
      expect(stored).toEqual([{ order: [build, plan, ren] }])
    }),
  )
})

describe("Space and agents acting in a session", () => {
  it.live(
    "an agent acts as its sender in every space, except the sender's private space when its chat is elsewhere (AC17, AC18)",
    () =>
      Effect.gen(function* () {
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* user(organizationId)
        const factory = yield* spaces.create(ada, { name: "Factory" })
        const other = yield* spaces.create(ada, { name: "Other" })
        const own = (yield* spaces.list(ada, page)).items.find((space) => space.kind === "private")
        if (!own) return yield* Effect.die(new Error("expected Ada's private space"))
        const agent = {
          ...ada,
          agent: { agentId: Agent.ID.create(), sessionId: Session.ID.create(), spaceId: factory.id, fence: own.id },
        }
        expect((yield* spaces.get(agent, other.id)).id).toBe(other.id)
        expect((yield* spaces.update(agent, other.id, { name: "Renamed" })).name).toBe("Renamed")
        expect((yield* Effect.flip(spaces.get(agent, own.id)))._tag).toBe("Primitive.NotFound")
        expect((yield* spaces.list(agent, page)).items.map((space) => space.id)).not.toContain(own.id)
      }),
  )
})
