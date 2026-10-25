import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Agent } from "@ren/schema/agent"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Layer, Queue, Struct } from "effect"
import type { Actor } from "../src/actor.js"
import { ChannelReply } from "../src/channel-reply.js"
import { Channels } from "../src/channels.js"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { Testing } from "@ren/db/testing"

setDefaultTimeout(60_000)

const it = testEffect(ChannelFixture.cellLayer)

const unstored = testEffect(ChannelFixture.unstoredLayer)

const routed = Effect.gen(function* () {
  const owner = yield* Seed.owner()
  return { owner, install: yield* ChannelFixture.install(owner) }
})

const sessionsOf = (owner: { readonly organizationId: Auth.OrganizationID }) =>
  Effect.flatMap(Database.Service, (database) =>
    database.db
      .select({ id: Database.Schema.agent_session.id, archivedAt: Database.Schema.agent_session.archived_at })
      .from(Database.Schema.agent_session)
      .where(eq(Database.Schema.agent_session.organization_id, owner.organizationId)),
  )

const started = Effect.fnUntraced(function* (owner: Effect.Success<typeof routed>["owner"]) {
  const sessionId = yield* Seed.session(owner)
  const cell = yield* ChannelFixture.Cell
  cell.start(sessionId)
  return sessionId
})

describe("Channels", () => {
  it.live(
    "an unknown provider answers 404, a body that does not parse 400, an ignored event 200, and a handshake its body",
    () =>
      Effect.gen(function* () {
        const channels = yield* Channels.Service
        const body = JSON.stringify({ type: "handshake", challenge: "c1" })
        expect(yield* channels.receive("telegram", ChannelFixture.request(body))).toEqual({ status: 404 })
        expect(yield* ChannelFixture.receive(`{"type":"event"`)).toEqual({ status: 400 })
        expect(yield* ChannelFixture.receive(JSON.stringify({ type: "ignore" }))).toEqual({ status: 200 })
        expect(yield* ChannelFixture.receive(body)).toEqual({ status: 200, body: { challenge: "c1" } })
        expect(yield* ChannelFixture.threads).toEqual([])
      }),
  )

  it.live("a bad signature answers 401 and stores no run, so the signed delivery of that event id runs", () =>
    Effect.gen(function* () {
      const install = (yield* routed).install
      const found = ChannelFixture.event(install)
      const forged = ChannelFixture.event(install, { eventId: found.eventId, thread: found.thread, text: "forged" })
      expect(yield* ChannelFixture.receive(ChannelFixture.delivery(forged), "not-a-signature")).toEqual({
        status: 401,
      })
      expect(yield* ChannelFixture.receive(ChannelFixture.delivery(found))).toEqual({ status: 200 })
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([{ kind: "start", prompt: { text: found.text } }])
    }),
  )

  unstored.live("a store that fails answers 500, so the provider delivers again", () =>
    Effect.gen(function* () {
      const found = ChannelFixture.event((yield* routed).install)
      expect(yield* ChannelFixture.receive(ChannelFixture.delivery(found))).toEqual({ status: 500 })
    }),
  )

  it.live("the same event delivered twice makes one run, and the brain gets one message", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.settled(found)
      const accepted = yield* ChannelFixture.accepted(1)
      const sessions = yield* sessionsOf(subject.owner)
      expect(sessions).toHaveLength(1)
      expect(accepted).toEqual([expect.objectContaining({ kind: "start", sessionId: sessions[0]?.id })])
      expect(yield* ChannelFixture.threads).toMatchObject([
        { provider: "slack", install: subject.install, thread: found.thread.id, session_id: sessions[0]?.id },
      ])
    }),
  )

  it.live("two first events on a new thread at the same time make one session that holds both messages", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const thread = { id: "C07:1712.33" }
      const first = ChannelFixture.event(subject.install, { thread, text: "the deploy failed" })
      const second = ChannelFixture.event(subject.install, { thread, text: "and the rollback too" })
      yield* Effect.all(
        [first, second].map((each) => ChannelFixture.receive(ChannelFixture.delivery(each))),
        { concurrency: "unbounded" },
      )
      const accepted = yield* ChannelFixture.accepted(2)
      const sessions = yield* sessionsOf(subject.owner)
      expect(sessions).toHaveLength(1)
      expect(accepted.map((message) => message.sessionId)).toEqual(
        sessions.flatMap((session) => [session.id, session.id]),
      )
      expect(accepted.map((message) => message.prompt.text).toSorted()).toEqual([
        "and the rollback too",
        "the deploy failed",
      ])
      expect(yield* ChannelFixture.threads).toHaveLength(1)
    }),
  )

  it.live("a thread whose session is archived moves to a new session, and the old session does not change", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const old = yield* Seed.session(subject.owner)
      const archivedAt = new Date("2026-10-01T00:00:00Z")
      yield* database.db
        .update(Database.Schema.agent_session)
        .set({ archived_at: archivedAt })
        .where(eq(Database.Schema.agent_session.id, old))
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, old)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      const accepted = yield* ChannelFixture.accepted(1)
      expect(accepted).toMatchObject([{ kind: "start" }])
      expect(accepted[0]?.sessionId).not.toBe(old)
      expect(yield* ChannelFixture.threads).toMatchObject([{ session_id: accepted[0]?.sessionId }])
      expect((yield* sessionsOf(subject.owner)).find((session) => session.id === old)).toEqual({
        id: old,
        archivedAt,
      })
    }),
  )

  it.live("a message to a session that exists steers it", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const sessionId = yield* started(subject.owner)
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([
        { kind: "send", sessionId, delivery: "steer", prompt: { text: found.text } },
      ])
    }),
  )

  it.live(
    "a message carries where it came from and the thread context, and goes on without a context it cannot read",
    () =>
      Effect.gen(function* () {
        const subject = yield* routed
        const first = ChannelFixture.event(subject.install)
        const second = ChannelFixture.event(subject.install, { thread: first.thread, message: "unreadable" })
        yield* ChannelFixture.receive(ChannelFixture.delivery(first))
        yield* ChannelFixture.settled(first)
        yield* ChannelFixture.receive(ChannelFixture.delivery(second))
        const origin = {
          provider: "slack",
          place: "eng",
          threadUrl: "https://acme.slack.com/archives/C07/p1712",
          sender: "Ana",
          handle: "ana",
        }
        expect(yield* ChannelFixture.accepted(2)).toMatchObject([
          { kind: "start", channel: { ...origin, context: "[Bob] the deploy failed at 10:02" } },
          { kind: "send", channel: origin },
        ])
        expect((yield* ChannelFixture.accepted(2))[1]?.channel).not.toHaveProperty("context")
      }),
  )

  it.live("a brain that is unavailable gets the message again with the same id until it accepts it once", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const sessionId = yield* started(subject.owner)
      const cell = yield* ChannelFixture.Cell
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      cell.failSends(5)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      const accepted = yield* ChannelFixture.accepted(1)
      expect(cell.sends).toHaveLength(6)
      expect(cell.sends).toEqual(accepted.flatMap((message) => Array.from({ length: 6 }, () => message.messageId)))
      yield* ChannelFixture.settled(found)
      expect(cell.accepted).toHaveLength(1)
    }),
  )

  it.live("an unmapped place goes to the oldest active space of the install's organization, as the installer", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const later = yield* Seed.space(subject.owner.organizationId)
      const archived = yield* Seed.space(subject.owner.organizationId)
      yield* Effect.forEach(
        [
          { id: archived, created_at: new Date("2026-01-01"), archived_at: new Date("2026-02-01") },
          { id: subject.owner.spaceId, created_at: new Date("2026-03-01"), archived_at: null },
          { id: later, created_at: new Date("2026-04-01"), archived_at: null },
        ],
        (row) =>
          database.db
            .update(Database.Schema.space)
            .set({ created_at: row.created_at, archived_at: row.archived_at })
            .where(eq(Database.Schema.space.id, row.id)),
      )
      yield* ChannelFixture.receive(ChannelFixture.delivery(ChannelFixture.event(subject.install)))
      const accepted = yield* ChannelFixture.accepted(1)
      expect(
        yield* database.db
          .select({
            spaceId: Database.Schema.agent_session.space_id,
            createdBy: Database.Schema.agent_session.created_by,
          })
          .from(Database.Schema.agent_session)
          .where(eq(Database.Schema.agent_session.id, accepted[0]?.sessionId ?? Session.ID.create())),
      ).toEqual([{ spaceId: subject.owner.spaceId, createdBy: subject.owner.createdBy }])
      expect(accepted[0]?.prompt).toEqual({ text: "the deploy failed" })
    }),
  )

  it.live("an event of a workspace that no organization installed starts nothing and posts no notice", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const notices = yield* ChannelFixture.Notices
      const found = ChannelFixture.event("T-not-installed")
      expect(yield* ChannelFixture.receive(ChannelFixture.delivery(found))).toEqual({ status: 200 })
      yield* ChannelFixture.settled(found)
      expect(yield* Queue.size(notices)).toBe(0)
      expect(yield* sessionsOf(owner)).toEqual([])
      expect(yield* ChannelFixture.threads).toEqual([])
    }),
  )

  it.live("a thread whose run stopped after its claim gets its session from the next event", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const claimed = Session.ID.create()
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, claimed)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([{ kind: "start", sessionId: claimed }])
      expect((yield* sessionsOf(subject.owner)).map((session) => session.id)).toEqual([claimed])
    }),
  )

  it.live("an uninstall event removes the install of its workspace and keeps the threads", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, Session.ID.create())
      expect(yield* ChannelFixture.receive(JSON.stringify({ type: "uninstalled", install: subject.install }))).toEqual({
        status: 200,
      })
      const database = yield* Database.Service
      expect(yield* database.db.select().from(Database.Schema.channel_install)).toEqual([])
      expect(yield* ChannelFixture.threads).toHaveLength(1)
    }),
  )

  it.live("a file that cannot be read is dropped with a note, and the message goes on", () =>
    Effect.gen(function* () {
      const found = ChannelFixture.event((yield* routed).install, {
        files: [
          { url: "bytes:3", name: "notes.txt", mime: "text/plain" },
          { url: "missing", name: "screenshot.png", mime: "image/png" },
        ],
      })
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([
        {
          prompt: {
            text: `${found.text}\n(screenshot.png could not be read.)`,
            files: [{ url: "data:text/plain;base64,YWFh", name: "notes.txt" }],
          },
        },
      ])
    }),
  )

  it.live("files over 10 MB in total: the file that passes the limit is skipped with a note", () =>
    Effect.gen(function* () {
      const found = ChannelFixture.event((yield* routed).install, {
        files: [
          { url: "bytes:6000000", name: "first.bin", mime: "application/octet-stream" },
          { url: "bytes:6000000", name: "second.bin", mime: "application/octet-stream" },
          { url: "bytes:1000", name: "third.txt", mime: "text/plain" },
        ],
      })
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      const accepted = yield* ChannelFixture.accepted(1)
      expect(accepted[0]?.prompt.text).toBe(
        `${found.text}\n(second.bin is not attached: a message’s files total at most 10 MB.)`,
      )
      expect(accepted[0]?.prompt.files?.map((file) => file.name)).toEqual(["first.bin", "third.txt"])
    }),
  )
})

const asAgent = (subject: Effect.Success<typeof routed>, sessionId: Session.ID): Actor.Info => ({
  userId: subject.owner.createdBy,
  organizationId: subject.owner.organizationId,
  roles: ["owner"],
  agent: { agentId: Agent.ID.create(), sessionId, spaceId: subject.owner.spaceId },
})

describe("ChannelReply", () => {
  it.live("a reply goes to the thread of the session's latest channel message, at its place and message", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const sessionId = yield* started(subject.owner)
      const replies = yield* ChannelReply.Service
      const outbox = yield* ChannelFixture.Outbox
      const first = ChannelFixture.event(subject.install)
      const second = ChannelFixture.event(subject.install, {
        place: { id: "C09", kind: "channel", name: "sales" },
        thread: { id: "C09:1713.90" },
        message: "1713.95",
      })
      yield* Effect.forEach([first, second], (each) =>
        ChannelFixture.thread(subject.owner.organizationId, each, sessionId).pipe(
          Effect.andThen(ChannelFixture.receive(ChannelFixture.delivery(each))),
          Effect.andThen(ChannelFixture.settled(each)),
        ),
      )
      expect(yield* replies.reply(asAgent(subject, sessionId), { text: "Rolled back." })).toEqual({
        provider: "slack",
        place: "sales",
      })
      expect(outbox.sent).toEqual([
        {
          target: { install: subject.install, place: "sales", thread: "C09:1713.90", message: "1713.95" },
          text: "Rolled back.",
        },
      ])
    }),
  )

  it.live("only a main agent in the session's organization with a channel thread can reply", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const replies = yield* ChannelReply.Service
      const parent = yield* started(subject.owner)
      const child = yield* started(subject.owner)
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, parent)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.settled(found)
      yield* database.db
        .update(Database.Schema.agent_session)
        .set({ parent_id: parent, root_id: parent })
        .where(eq(Database.Schema.agent_session.id, child))
      expect(
        (yield* Effect.flip(replies.reply(Struct.omit(asAgent(subject, parent), ["agent"]), { text: "hi" }))).message,
      ).toBe("Only the agent of a chat that came from a channel replies in its thread.")
      expect(
        (yield* Effect.flip(
          replies.reply({ ...asAgent(subject, parent), organizationId: yield* Seed.organization() }, { text: "hi" }),
        )).message,
      ).toBe("This chat has no thread to reply to.")
      expect((yield* Effect.flip(replies.reply(asAgent(subject, child), { text: "hi" }))).message).toBe(
        "Only the main agent replies in the thread.",
      )
      expect(
        (yield* Effect.flip(replies.reply(asAgent(subject, yield* started(subject.owner)), { text: "hi" }))).message,
      ).toBe("This chat has no thread to reply to.")
      expect((yield* ChannelFixture.Outbox).sent).toEqual([])
    }),
  )

  it.live("a gone thread or a refusal returns an error at once; a provider that does not answer is tried 4 times", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const sessionId = yield* started(subject.owner)
      const replies = yield* ChannelReply.Service
      const outbox = yield* ChannelFixture.Outbox
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.settled(found)
      const failed = yield* Effect.forEach(["gone", "refused", "down"], (text) =>
        ChannelFixture.quickly(Effect.flip(replies.reply(asAgent(subject, sessionId), { text }))),
      )
      expect(failed.map((error) => error.message)).toEqual([
        "The Slack thread is gone, so the reply was not sent.",
        "Slack refused the reply: msg_too_long",
        "Slack did not answer, so the reply was not sent. Try again later.",
      ])
      expect(outbox.attempts).toEqual(["gone", "refused", "down", "down", "down", "down"])
    }),
  )
})

const onBrains = testEffect(ChannelFixture.sandboxLayer)

describe("Channels on brains", () => {
  onBrains.live("a failed brain stops the run with one notice", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const notices = yield* ChannelFixture.Notices
      const sessionId = yield* Seed.session(subject.owner)
      yield* database.db
        .update(Database.Schema.brain)
        .set({ phase: "failed", failures: 3, failure: "the template is broken" })
        .where(eq(Database.Schema.brain.id, Brain.ofSession(sessionId)))
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      expect(yield* Queue.take(notices)).toEqual({ event: found, reason: "brain_failed" })
      yield* ChannelFixture.settled(found)
      expect(yield* Queue.size(notices)).toBe(0)
    }),
  )
})

const durable = testEffect(Testing.layer)

describe("Channels across a restart", () => {
  durable.live("a run that Ren stopped mid-way runs again after Ren starts, from the run it stored", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const found = ChannelFixture.event(subject.install, {
        files: [{ url: "held", name: "log.txt", mime: "text/plain" }],
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const ren = yield* Layer.build(ChannelFixture.durableLayer({ held: true }))
          yield* Effect.gen(function* () {
            expect(yield* ChannelFixture.receive(ChannelFixture.delivery(found))).toEqual({ status: 200 })
            yield* Effect.flatMap(ChannelFixture.Hold, (hold) => Deferred.await(hold.entered))
          }).pipe(Effect.provide(ren))
        }),
      )
      const ren = yield* Layer.build(ChannelFixture.durableLayer({ held: false }))
      const accepted = yield* ChannelFixture.accepted(1).pipe(Effect.provide(ren))
      expect(accepted).toMatchObject([{ kind: "start", prompt: { text: found.text, files: [{ name: "log.txt" }] } }])
    }),
  )
})
