import { describe, expect, setDefaultTimeout } from "bun:test"
import { BrainToken } from "@ren/host-api/brain-token"
import { TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Brain } from "@ren/schema/brain"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Option, Schedule, Schema } from "effect"
import { Brains } from "../src/brains.js"
import { Session } from "../src/session.js"
import { Space } from "../src/space.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { OpenCodeExport } from "./lib/opencode-export.js"
import { SavedHistory } from "./lib/saved-history.js"
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
        expect((yield* sessions.models(ada, id)).models).toEqual([
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

  it.live(
    "a chat whose brain failed before it started starts with its first message after a Retry that sends no message, as the app's does",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const database = yield* Database.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* Configured.member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const brainId = Brain.ID.create()
        yield* database.db.insert(Database.Schema.brain).values({
          id: brainId,
          organization_id: organizationId,
          space_id: team.id,
          scope: "space",
          phase: "failed",
          failures: 3,
          failure: "the template is broken",
          run_epoch: 1,
        })
        const script = Configured.stub.script()
        const id = Session.ID.create()
        yield* sessions.create(ada, {
          id,
          spaceId: team.id,
          message: { id: SessionMessage.ID.create(), text: `plan ${script.marker}` },
        })
        const stored = (yield* database.db
          .select({ start: Database.Schema.agent_session.start_input })
          .from(Database.Schema.agent_session)
          .where(eq(Database.Schema.agent_session.id, id))).at(0)?.start
        const execution = yield* Brains.StartRun.executionId(
          yield* Schema.decodeUnknownEffect(Brains.StartRun.payloadSchema)({
            input: stored,
            placement: { organizationId, spaceId: team.id, brainId },
            epoch: 1,
          }),
        )
        yield* Brains.StartRun.poll(execution).pipe(
          Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced("100 millis") }),
          Effect.timeout("20 seconds"),
        )
        yield* sessions.retry(ada, id, undefined)
        expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
      }),
  )

  it.live("Ren refuses a page of saved history over 16 MiB; a smaller page of the same chat reads", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const chat = yield* SavedHistory.saved(["a".repeat(9 * 1024 * 1024), "b".repeat(9 * 1024 * 1024)])
      expect((yield* Effect.flip(sessions.messages(chat.actor, chat.id, { limit: 2 })))._tag).toBe(
        "Session.PageTooLarge",
      )
      expect((yield* sessions.messages(chat.actor, chat.id, { limit: 1 })).items).toHaveLength(1)
    }),
  )

  it.live(
    "a member imports an OpenCode session into a space: the chat keeps its ID and title, starts from OpenCode and has its history; importing again is safe for its creator, and the ID is a conflict in another space or as a new chat",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const spaces = yield* Space.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* Configured.member(organizationId)
        const grace = yield* Configured.member(organizationId)
        const team = yield* spaces.create(ada, { name: "Team" })
        const exported = yield* OpenCodeExport.make("Fix the login loop", ["Look at auth.ts.", "It loops on refresh."])
        const input = {
          spaceId: team.id,
          harness: "opencode" as const,
          model: { providerID: "stub", id: "stub-other" },
          transcript: exported.transcript,
        }
        expect((yield* Effect.flip(sessions.import(grace, exported.id, input)))._tag).toBe("Primitive.NotFound")
        const imported = yield* sessions.import(ada, exported.id, input)
        expect(imported).toMatchObject({
          id: exported.id,
          spaceId: team.id,
          createdBy: ada.userId,
          origin: "opencode",
          title: "Fix the login loop",
        })
        const history = yield* sessions.messages(ada, exported.id, {})
        expect(
          history.items.flatMap((message) =>
            message.type === "user" || message.type === "assistant" ? [message.type] : [],
          ),
        ).toEqual(["assistant", "user", "assistant", "user"])
        expect(
          history.items.flatMap((message) =>
            message.type === "assistant"
              ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
              : [],
          ),
        ).toEqual(["It loops on refresh.", "Look at auth.ts."])
        expect(
          (yield* sessions.list(ada, { ...Configured.page, origin: ["opencode"] })).items.map((item) => item.id),
        ).toEqual([exported.id])
        expect(yield* sessions.import(ada, exported.id, input)).toMatchObject({ id: exported.id, origin: "opencode" })
        expect((yield* sessions.messages(ada, exported.id, {})).items).toEqual(history.items)
        const other = (yield* spaces.list(ada, Configured.page)).items.find((space) => space.id !== team.id)
        if (!other) return yield* Effect.die(new Error("Ada has one space"))
        const conflicts = yield* Effect.all([
          Effect.flip(sessions.create(ada, { id: exported.id, spaceId: team.id })),
          Effect.flip(sessions.import(ada, exported.id, { ...input, spaceId: other.id })),
        ])
        expect(conflicts.map((error) => error._tag)).toEqual(["Primitive.Conflict", "Primitive.Conflict"])
      }),
  )

  it.live(
    "an import is refused when its transcript is of another session or is not an OpenCode export, or its model is not offered",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const organizationId = yield* Seed.organization()
        const ada = yield* Configured.member(organizationId)
        const spaces = yield* Space.Service
        const spaceId = (yield* spaces.list(ada, Configured.page)).items.at(0)?.id
        if (!spaceId) return yield* Effect.die(new Error("Ada has no space"))
        const exported = yield* OpenCodeExport.make("A session", ["Done."])
        const refused = (id: Session.ID, input: Partial<Parameters<Session.Interface["import"]>[2]>) =>
          sessions
            .import(ada, id, { spaceId, harness: "opencode", transcript: exported.transcript, ...input })
            .pipe(Effect.flip)
        const errors = yield* Effect.all([
          refused(Session.ID.create(), {}),
          refused(exported.id, { transcript: { info: { id: exported.id }, messages: [] } }),
          refused(exported.id, { model: { providerID: "stub", id: "gone" } }),
        ])
        expect(errors.map((error) => [error._tag, "field" in error ? error.field : undefined])).toEqual([
          ["Primitive.Invalid", "transcript"],
          ["Primitive.Invalid", "transcript"],
          ["Primitive.NotFound", undefined],
        ])
        expect((yield* Effect.flip(sessions.get(ada, exported.id)))._tag).toBe("Primitive.NotFound")
      }),
  )
})
