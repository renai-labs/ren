import { expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Access } from "../src/access.js"
import { Actor } from "../src/actor.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Actor.layer.pipe(Layer.provide(Access.layer), Layer.provideMerge(Testing.layer)))

const chat = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  yield* Seed.ren()
  const organizationId = yield* Seed.organization()
  const creator = yield* Seed.actor(organizationId, "owner")
  const spaceId = yield* Seed.space(organizationId)
  const sessionId = yield* Seed.session({ organizationId, spaceId, createdBy: creator.userId })
  const join = Effect.fnUntraced(function* (role: string, options: { readonly inSpace: boolean }) {
    const joined = yield* Seed.actor(organizationId, role)
    if (options.inSpace)
      yield* database.db
        .insert(Database.Schema.space_member)
        .values({ id: Space.MembershipID.create(), space_id: spaceId, user_id: joined.userId })
    return joined.userId
  })
  return { organizationId, spaceId, sessionId, brainId: Brain.ofSession(sessionId), creator: creator.userId, join }
})

it.live("a chat's actor is the sender of the turn, with the sender's roles, the chat's agent and its space", () =>
  Effect.gen(function* () {
    const actors = yield* Actor.Service
    const subject = yield* chat()
    const member = yield* subject.join("member", { inSpace: true })
    const ref = { sessionId: subject.sessionId, organizationId: subject.organizationId, brainId: subject.brainId }
    expect(yield* actors.fromSession({ ...ref, userId: member })).toMatchObject({
      userId: member,
      organizationId: subject.organizationId,
      roles: ["member"],
      agent: { sessionId: subject.sessionId, spaceId: subject.spaceId },
    })
    expect(yield* actors.fromSession({ ...ref, userId: subject.creator })).toMatchObject({
      userId: subject.creator,
      roles: ["owner"],
    })
  }),
)

it.live("a chat's actor is its creator when the turn has no known sender", () =>
  Effect.gen(function* () {
    const actors = yield* Actor.Service
    const subject = yield* chat()
    expect(
      yield* actors.fromSession({
        sessionId: subject.sessionId,
        organizationId: subject.organizationId,
        brainId: subject.brainId,
      }),
    ).toMatchObject({ userId: subject.creator, roles: ["owner"] })
  }),
)

it.live("the sender must see the chat: a space member or an organization admin, not another member", () =>
  Effect.gen(function* () {
    const actors = yield* Actor.Service
    const subject = yield* chat()
    const ref = { sessionId: subject.sessionId, organizationId: subject.organizationId, brainId: subject.brainId }
    const admin = yield* subject.join("admin", { inSpace: false })
    const outsider = yield* subject.join("member", { inSpace: false })
    expect(yield* actors.fromSession({ ...ref, userId: admin })).toMatchObject({ userId: admin, roles: ["admin"] })
    expect((yield* Effect.flip(actors.fromSession({ ...ref, userId: outsider })))._tag).toBe("Primitive.Forbidden")
  }),
)

it.live(
  "refuses a sender outside the organization, a chat on another brain or in another organization, and an archived chat or space",
  () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const actors = yield* Actor.Service
      const subject = yield* chat()
      const ref = { sessionId: subject.sessionId, organizationId: subject.organizationId, brainId: subject.brainId }
      const member = yield* subject.join("member", { inSpace: true })
      const refused = (input: Actor.SessionRef) =>
        Effect.flip(actors.fromSession(input)).pipe(Effect.map((error) => error._tag))
      expect(yield* refused({ ...ref, organizationId: Auth.OrganizationID.create() })).toBe("Primitive.Forbidden")
      expect(yield* refused({ ...ref, brainId: Brain.ID.create() })).toBe("Primitive.Forbidden")
      expect(yield* refused({ ...ref, userId: Auth.UserID.create() })).toBe("Primitive.Forbidden")
      yield* database.db.delete(Database.Schema.member).where(eq(Database.Schema.member.userId, member))
      expect(yield* refused({ ...ref, userId: member })).toBe("Primitive.Forbidden")
      yield* database.db
        .update(Database.Schema.agent_session)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent_session.id, subject.sessionId))
      expect(yield* refused(ref)).toBe("Primitive.Forbidden")
      const other = yield* chat()
      yield* database.db
        .update(Database.Schema.space)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.space.id, other.spaceId))
      expect(
        yield* refused({ sessionId: other.sessionId, organizationId: other.organizationId, brainId: other.brainId }),
      ).toBe("Primitive.Forbidden")
    }),
)
