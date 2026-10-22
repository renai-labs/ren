import { describe, expect, setDefaultTimeout } from "bun:test"
import { BrainToken } from "@ren/host-api/brain-token"
import { Shared, TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { Auth } from "@ren/schema/auth"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Layer, Option, Schedule } from "effect"
import { Access } from "../src/access.js"
import { BrainRegistry } from "../src/brain-registry.js"
import { Models } from "../src/models.js"
import { Session } from "../src/session.js"
import { SessionRunner } from "../src/session/runner.js"
import { Space } from "../src/space.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, stub.url)

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
  }),
)

const it = testEffect(
  Layer.mergeAll(Session.layer, Space.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(SessionRunner.layer),
    Layer.provideMerge(BrainRegistry.layer),
    Layer.provideMerge(Host.layer({}, models)),
    Layer.provideMerge(models),
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
  ),
)

const page = { page: 1, pageSize: 50 }

const member = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role = "member") {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role] }
})

const claims = (token: string) =>
  BrainToken.verify(
    Host.keys.map((key) => key.publicKey),
    token,
  ).pipe(Effect.map(Option.getOrUndefined))

describe("Session", () => {
  it.live(
    "a member starts a chat with its first message in a space; members of the space see it, others do not, and its access carries the member",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* member(organizationId)
        const grace = yield* member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const script = stub.script()
        const id = Session.ID.create()
        const created = yield* sessions.create(ada, {
          id,
          spaceId: team.id,
          message: { id: SessionMessage.ID.create(), text: `plan ${script.marker}` },
        })
        expect(created).toMatchObject({ id, spaceId: team.id, createdBy: ada.userId, archivedAt: null })
        expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
        expect((yield* sessions.list(ada, { spaceId: team.id, ...page })).items.map((item) => item.id)).toEqual([id])
        expect(yield* sessions.list(grace, { spaceId: team.id, ...page })).toMatchObject({ items: [], total: 0 })
        expect((yield* sessions.list(ada, page)).items.map((item) => item.id)).toEqual([id])
        expect(yield* sessions.list(grace, page)).toMatchObject({ items: [], total: 0 })
        expect((yield* Effect.flip(sessions.get(grace, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.access(grace, id)))._tag).toBe("Primitive.NotFound")
        expect((yield* Effect.flip(sessions.create(grace, { id: Session.ID.create(), spaceId: team.id })))._tag).toBe(
          "Primitive.NotFound",
        )
        const access = yield* Host.ready(sessions.access(ada, id))
        expect(yield* claims(access.token)).toMatchObject({
          sid: id,
          scope: "client",
          sub: ada.userId,
          name: `Ada (${ada.userId.toLowerCase()}@example.com)`,
        })
        const read = yield* Effect.promise(() =>
          fetch(`${access.url}/chat/session/${id}`, { headers: { authorization: TestToken.basic(access.token) } }),
        )
        expect(read.status).toBe(200)
      }),
  )

  it.live(
    "a member lists the models a new chat may use, the chat starts with the one picked, and an unlisted one is refused",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* member(organizationId)
        const spaceId = (yield* spaces.list(ada, page)).items.at(0)?.id
        if (!spaceId) return yield* Effect.die(new Error("Ada has no space"))
        const id = Session.ID.create()
        expect(yield* sessions.models(ada, id)).toEqual([
          { id: "stub-model", providerID: "stub", name: "Stub", variants: [] },
          { id: "stub-other", providerID: "stub", name: "Stub Other", variants: [] },
        ])
        const script = stub.script()
        yield* sessions.create(ada, {
          id,
          spaceId,
          model: { providerID: "stub", id: "stub-other" },
          message: { id: SessionMessage.ID.create(), text: script.marker },
        })
        expect((yield* Effect.promise(() => script.called())).body.model).toBe("stub-other")
        const unlisted = yield* sessions
          .create(ada, {
            id: Session.ID.create(),
            spaceId,
            model: { providerID: "stub", id: "stub-other", variant: "max" },
          })
          .pipe(Effect.flip)
        expect(unlisted).toMatchObject({ _tag: "Primitive.NotFound", message: "Model not found." })
      }),
  )

  it.live("creating again with the same ID is safe for its creator and a conflict for anyone else", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* member(organizationId)
      const admin = yield* member(organizationId, "admin")
      const spaces = yield* Space.Service
      const spaceId = (yield* spaces.list(ada, page)).items.at(0)?.id
      if (!spaceId) return yield* Effect.die(new Error("Ada has no space"))
      const id = Session.ID.create()
      yield* sessions.create(ada, { id, spaceId })
      expect(yield* sessions.create(ada, { id, spaceId })).toMatchObject({ id })
      expect((yield* Effect.flip(sessions.create(admin, { id, spaceId })))._tag).toBe("Primitive.Conflict")
    }),
  )

  it.live("its creator or an admin archives a chat, which leaves the list; another member may not", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const spaces = yield* Space.Service
      const organizationId = yield* Seed.organization()
      const ada = yield* member(organizationId)
      const grace = yield* member(organizationId)
      const admin = yield* member(organizationId, "admin")
      const general = (yield* spaces.list(ada, page)).items.at(0)
      if (!general) return yield* Effect.die(new Error("Ada has no space"))
      const first = Session.ID.create()
      const second = Session.ID.create()
      yield* sessions.create(ada, { id: first, spaceId: general.id })
      yield* sessions.create(ada, { id: second, spaceId: general.id })
      expect((yield* Effect.flip(sessions.archive(grace, first)))._tag).toBe("Primitive.Forbidden")
      expect((yield* sessions.archive(ada, first)).archivedAt).not.toBeNull()
      expect((yield* sessions.archive(admin, second)).archivedAt).not.toBeNull()
      expect((yield* sessions.list(ada, { spaceId: general.id, ...page })).items).toEqual([])
    }),
  )
  it.live(
    "typing in a new chat wakes the space's brain for a member of the space, and is not found for anyone else",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const database = yield* Database.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* member(organizationId)
        const grace = yield* member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const script = stub.script()
        yield* sessions.create(ada, {
          id: Session.ID.create(),
          spaceId: team.id,
          message: { id: SessionMessage.ID.create(), text: `plan ${script.marker}` },
        })
        yield* Effect.promise(() => script.called())
        const brain = Database.Schema.brain
        yield* database.db.update(brain).set({ phase: "resuming" }).where(eq(brain.space_id, team.id))
        yield* sessions.prepare(ada, team.id)
        const phase = database.db
          .select({ phase: brain.phase })
          .from(brain)
          .where(eq(brain.space_id, team.id))
          .pipe(Effect.map((rows) => rows.at(0)?.phase))
        expect(
          yield* phase.pipe(
            Effect.repeat({ until: (found) => found === "ready", schedule: Schedule.spaced("100 millis") }),
            Effect.timeout("30 seconds"),
          ),
        ).toBe("ready")
        expect((yield* sessions.prepare(grace, team.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      }),
  )
})
