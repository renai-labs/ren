import { describe, expect, setDefaultTimeout } from "bun:test"
import { BrainToken } from "@ren/host-api/brain-token"
import { TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Option, Schedule } from "effect"
import { Session } from "../src/session.js"
import { Space } from "../src/space.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const it = testEffect(Configured.sessionLayer)

const claims = (token: string) =>
  BrainToken.verify(
    Host.keys.map((key) => key.publicKey),
    token,
  ).pipe(Effect.map(Option.getOrUndefined))

describe("Session", () => {
  it.live(
    "a member starts a chat with its first message in a space; members of the space see it, others do not, and its first message and access carry the member",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* Configured.member(organizationId)
        const grace = yield* Configured.member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const script = Configured.stub.script()
        const id = Session.ID.create()
        const created = yield* sessions.create(ada, {
          id,
          spaceId: team.id,
          message: { id: SessionMessage.ID.create(), text: `plan ${script.marker}` },
        })
        expect(created).toMatchObject({ id, spaceId: team.id, createdBy: ada.userId, archivedAt: null })
        expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
        const database = yield* Database.Service
        const row = (yield* database.db
          .select({ start: Database.Schema.agent_session.start_input })
          .from(Database.Schema.agent_session)
          .where(eq(Database.Schema.agent_session.id, id))).at(0)
        expect(row?.start).toMatchObject({ initialMessage: { sender: { userId: ada.userId, memberId: ada.memberId } } })
        expect(
          (yield* sessions.list(ada, { spaceId: [team.id], ...Configured.page })).items.map((item) => item.id),
        ).toEqual([id])
        expect(yield* sessions.list(grace, { spaceId: [team.id], ...Configured.page })).toMatchObject({
          items: [],
          total: 0,
        })
        expect((yield* sessions.list(ada, Configured.page)).items.map((item) => item.id)).toEqual([id])
        expect(yield* sessions.list(grace, Configured.page)).toMatchObject({ items: [], total: 0 })
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
          member: ada.memberId,
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
        const ada = yield* Configured.member(organizationId)
        const spaceId = (yield* spaces.list(ada, Configured.page)).items.at(0)?.id
        if (!spaceId) return yield* Effect.die(new Error("Ada has no space"))
        const id = Session.ID.create()
        expect(yield* sessions.models(ada, id)).toEqual([
          { id: "stub-model", providerID: "stub", name: "Stub", variants: [] },
          { id: "stub-other", providerID: "stub", name: "Stub Other", variants: [] },
        ])
        const script = Configured.stub.script()
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

  it.live(
    "typing in a new chat wakes the space's brain for a member of the space, and is not found for anyone else",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const database = yield* Database.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* Configured.member(organizationId)
        const grace = yield* Configured.member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const script = Configured.stub.script()
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
