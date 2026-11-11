import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Agent } from "@ren/schema/agent"
import { Brain } from "@ren/schema/brain"
import { Channel } from "@ren/schema/channel"
import { IntakeThread } from "@ren/schema/intake-thread"
import { ChannelInstall } from "@ren/schema/channel-install"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Deferred, Effect, Layer, Option, Schedule } from "effect"
import { ChannelIdentity } from "../src/channel-identity.js"
import { ChannelInstalls } from "../src/channel-installs.js"
import { ChannelMappings } from "../src/channel-mappings.js"
import { ChannelRoute } from "../src/channel-route.js"
import { ChannelTurns } from "../src/channel-turns.js"
import { ChannelEventRun } from "../src/channel-event-run.js"
import { DurableRunner } from "../src/durable-runner.js"
import { Intake } from "../src/intake.js"
import { Drives } from "../src/drives.js"
import { Task } from "../src/task.js"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SyncFixture } from "./lib/sync-fixture.js"
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

const ownerOf = (sessionId: Session.ID) =>
  Effect.flatMap(Database.Service, (database) =>
    database.db
      .select({
        organizationId: Database.Schema.agent_session.organization_id,
        spaceId: Database.Schema.agent_session.space_id,
      })
      .from(Database.Schema.agent_session)
      .where(eq(Database.Schema.agent_session.id, sessionId))
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) => Effect.fromNullishOr(rows.at(0))),
        Effect.orDie,
      ),
  )

const started = Effect.fnUntraced(function* (owner: Effect.Success<typeof routed>["owner"]) {
  const sessionId = yield* Seed.session(owner)
  const cell = yield* ChannelFixture.Cell
  cell.start(sessionId)
  return sessionId
})

describe("Channels", () => {
  it.live("a rejected follow-up links to the existing channel session", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const sessionId = yield* started(subject.owner)
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      const cell = yield* ChannelFixture.Cell
      cell.rejectSends()
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.settled(found)
      expect((yield* ChannelFixture.Outbox).sent.map((sent) => sent.text)).toEqual([
        `Something went wrong while I was working on your message. Please try again. [Open in Ren](${ChannelFixture.app}/sessions/${sessionId})`,
      ])
    }),
  )

  it.live(
    "an unknown provider answers 404, a body that does not parse 400, an ignored event 200, and a handshake its body",
    () =>
      Effect.gen(function* () {
        const intake = yield* Intake.Service
        const body = JSON.stringify({ type: "handshake", challenge: "c1" })
        expect(yield* intake.receive("linear", ChannelFixture.request(body))).toEqual({ status: 404 })
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
        {
          origin: "slack",
          origin_id: subject.install,
          thread_key: found.thread.id,
          current_session_id: sessions[0]?.id,
        },
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
      expect(yield* ChannelFixture.threads).toMatchObject([{ current_session_id: accepted[0]?.sessionId }])
      expect((yield* sessionsOf(subject.owner)).find((session) => session.id === old)).toEqual({
        id: old,
        archivedAt,
      })
    }),
  )

  it.live("a message to a session that exists steers it, and its thread keeps the message's data", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const subject = yield* routed
      const sessionId = yield* started(subject.owner)
      const found = ChannelFixture.event(subject.install, { data: { slack: { actionToken: "12345.98765.abcd" } } })
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([
        { kind: "send", sessionId, delivery: "steer", prompt: { text: found.text } },
      ])
      expect(
        yield* database.db
          .select({ state: Database.Schema.intake_thread.channel_state })
          .from(Database.Schema.intake_thread)
          .where(eq(Database.Schema.intake_thread.current_session_id, sessionId)),
      ).toMatchObject([{ state: { slack: { actionToken: "12345.98765.abcd" } } }])
    }),
  )

  it.live("the provider fills in the event before the route, so the agent reads names, not ids", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const found = ChannelFixture.event(subject.install, { text: "ask <@U02> about it" })
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([
        { kind: "start", prompt: { text: "ask @Bob about it" } },
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
      cell.failSends(1)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      const accepted = yield* ChannelFixture.accepted(1)
      expect(cell.sends).toHaveLength(2)
      expect(cell.sends).toEqual(accepted.flatMap((message) => Array.from({ length: 2 }, () => message.messageId)))
      yield* ChannelFixture.settled(found)
      expect(cell.accepted).toHaveLength(1)
    }),
  )

  it.live("an unmapped place goes to the oldest active space of the install's organization, as the installer", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const later = yield* Seed.space(subject.owner.organizationId)
      yield* Seed.join(later, subject.owner.createdBy)
      const archived = yield* Seed.space(subject.owner.organizationId)
      yield* Seed.join(archived, subject.owner.createdBy)
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
      const outbox = yield* ChannelFixture.Outbox
      const found = ChannelFixture.event("T-not-installed")
      expect(yield* ChannelFixture.receive(ChannelFixture.delivery(found))).toEqual({ status: 200 })
      yield* ChannelFixture.settled(found)
      expect(outbox.sent).toEqual([])
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

  it.live(
    "a channel file goes to the space's drive under its chat and message, and reaches the brain by its path with an inline copy; a file that cannot be read is dropped with a note",
    () =>
      Effect.gen(function* () {
        const found = ChannelFixture.event((yield* routed).install, {
          files: [
            { url: "bytes:3", name: "notes.txt", mime: "text/plain" },
            { url: "missing", name: "screenshot.png", mime: "image/png" },
            { url: "bytes:2", name: "notes.txt", mime: "text/plain" },
          ],
        })
        yield* ChannelFixture.receive(ChannelFixture.delivery(found))
        const sent = (yield* ChannelFixture.accepted(1)).at(0)
        const folder = `chats/${sent?.sessionId}/uploads/${sent?.messageId}`
        expect(sent?.prompt).toEqual({
          text: `${found.text}\n(screenshot.png could not be read.)`,
          files: [
            { path: `${folder}/notes.txt`, name: "notes.txt" },
            { path: `${folder}/notes (2).txt`, name: "notes (2).txt" },
          ],
          fallback: [
            { url: "data:text/plain;base64,YWFh", name: "notes.txt" },
            { url: "data:text/plain;base64,YWE=", name: "notes (2).txt" },
          ],
        })
        const owner = yield* ownerOf(sent?.sessionId ?? Session.ID.create())
        const drives = yield* Drives.Service
        expect(new TextDecoder().decode(yield* drives.read(owner, `${folder}/notes.txt`))).toBe("aaa")
        expect(new TextDecoder().decode(yield* drives.read(owner, `${folder}/notes (2).txt`))).toBe("aa")
      }),
  )

  it.live("the files of earlier thread messages go to the drive after the message's own, and a file in both once", () =>
    Effect.gen(function* () {
      const outbox = yield* ChannelFixture.Outbox
      const notes = { url: "bytes:3", name: "notes.txt", mime: "text/plain" }
      outbox.earlierFiles.push({ url: "bytes:4", name: "shot.png", mime: "image/png" }, notes)
      yield* ChannelFixture.receive(
        ChannelFixture.delivery(ChannelFixture.event((yield* routed).install, { files: [notes] })),
      )
      const sent = (yield* ChannelFixture.accepted(1)).at(0)
      const folder = `chats/${sent?.sessionId}/uploads/${sent?.messageId}`
      expect(sent?.prompt.files).toEqual([
        { path: `${folder}/notes.txt`, name: "notes.txt" },
        { path: `${folder}/shot.png`, name: "shot.png" },
      ])
    }),
  )

  it.live("every file goes to the drive, and inline copies stop at each kind's limit and at 20 MiB in total", () =>
    Effect.gen(function* () {
      const found = ChannelFixture.event((yield* routed).install, {
        files: [
          { url: "bytes:12000000", name: "first.bin", mime: "application/octet-stream" },
          { url: "bytes:12000000", name: "second.bin", mime: "application/octet-stream" },
          { url: "bytes:1000", name: "third.txt", mime: "text/plain" },
          { url: "bytes:11000000", name: "long.txt", mime: "text/plain" },
        ],
      })
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      const accepted = yield* ChannelFixture.accepted(1)
      expect(accepted[0]?.prompt.text).toBe(found.text)
      expect(accepted[0]?.prompt.files?.map((file) => file.name)).toEqual([
        "first.bin",
        "second.bin",
        "third.txt",
        "long.txt",
      ])
      expect(accepted[0]?.prompt.fallback?.map((file) => file.name)).toEqual(["first.bin", "third.txt"])
    }),
  )
})

const turnEnded = Effect.fnUntraced(function* (
  subject: Effect.Success<typeof routed>,
  sessionId: Session.ID,
  turn: {
    readonly idle: number
    readonly outcome: "succeeded" | "failed"
    readonly messages: ReadonlyArray<{ readonly id: string; readonly type: string; readonly data: object }>
  },
) {
  const turns = yield* ChannelTurns.Service
  yield* SyncFixture.pass(
    SyncFixture.host(subject.owner.organizationId, sessionId),
    SyncFixture.session(sessionId, { time_idle: turn.idle, idle_outcome: turn.outcome }),
    turn.messages.length,
    turn.messages.map((message, index) =>
      SyncFixture.message(sessionId, message.id, index + 1, { type: message.type, data: JSON.stringify(message.data) }),
    ),
  )
  yield* turns.synced(sessionId)
  const executionId = yield* ChannelTurns.TurnRun.executionId({ sessionId, idle: turn.idle })
  yield* ChannelTurns.TurnRun.poll(executionId).pipe(
    Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced("20 millis") }),
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () => Effect.die(new Error("The turn run did not finish")),
    }),
  )
})

const fromChannel = { id: "msg_1", type: "user", data: { text: "the deploy failed", metadata: { channel: {} } } }

const answered = { id: "msg_2", type: "assistant", data: { content: [] } }

const threadOf = Effect.fnUntraced(function* (subject: Effect.Success<typeof routed>) {
  const sessionId = yield* started(subject.owner)
  const found = ChannelFixture.event(subject.install)
  yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
  yield* ChannelFixture.receive(ChannelFixture.delivery(found))
  yield* ChannelFixture.settled(found)
  return { sessionId, found }
})

describe("ChannelTurns", () => {
  it.live("a reminder never earns another reminder, but a new channel message can", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const outbox = yield* ChannelFixture.Outbox
      const thread = yield* threadOf(subject)
      yield* turnEnded(subject, thread.sessionId, { idle: 1, outcome: "succeeded", messages: [fromChannel, answered] })
      const reminders = (yield* ChannelFixture.accepted(2)).filter((delivered) => delivered.synthetic)
      expect(reminders).toMatchObject([
        {
          kind: "send",
          sessionId: thread.sessionId,
          delivery: "queue",
          prompt: {
            text: "You have not answered in the Slack thread. Text in this chat is not sent there: answer the person with slack_send_message.",
          },
          synthetic: { description: "Reminder: reply in the thread", source: "channel" },
        },
      ])
      yield* turnEnded(subject, thread.sessionId, { idle: 1, outcome: "succeeded", messages: [fromChannel, answered] })
      yield* turnEnded(subject, thread.sessionId, { idle: 2, outcome: "succeeded", messages: [fromChannel, answered] })
      expect((yield* ChannelFixture.Cell).accepted.filter((delivered) => delivered.synthetic)).toHaveLength(1)
      expect(outbox.progress).toEqual([
        { message: thread.found.message, status: "received" },
        { message: thread.found.message, status: "done" },
        { message: thread.found.message, status: "done" },
      ])
      yield* turnEnded(subject, thread.sessionId, {
        idle: 3,
        outcome: "succeeded",
        messages: [fromChannel, answered, { ...fromChannel, id: "msg_3" }, { ...answered, id: "msg_4" }],
      })
      expect((yield* ChannelFixture.Cell).accepted.filter((delivered) => delivered.synthetic)).toHaveLength(2)
    }),
  )

  it.live("a reply in the thread before the turn ends needs no reminder", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const thread = yield* threadOf(subject)
      yield* database.db
        .update(Database.Schema.intake_thread)
        .set({
          channel_state: sql`${Database.Schema.intake_thread.channel_state} || ${JSON.stringify({ lastReplyAt: new Date().toISOString() })}::jsonb`,
        })
        .where(eq(Database.Schema.intake_thread.current_session_id, thread.sessionId))
      yield* turnEnded(subject, thread.sessionId, { idle: 1, outcome: "succeeded", messages: [fromChannel, answered] })
      expect((yield* ChannelFixture.Cell).accepted.filter((delivered) => delivered.synthetic)).toEqual([])
    }),
  )

  it.live("a thread whose provider has no reply tool, such as GitHub, gets the end marker and no reminder", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const sessionId = yield* started(subject.owner)
      yield* database.db.insert(Database.Schema.intake_thread).values({
        id: IntakeThread.ID.create(),
        organization_id: subject.owner.organizationId,
        origin: "github",
        origin_id: subject.install,
        thread_key: "123:7",
        current_session_id: sessionId,
        channel_state: { placeName: "acme/api", lastMessage: "issue:456", lastMessageAt: new Date().toISOString() },
      })
      yield* turnEnded(subject, sessionId, { idle: 1, outcome: "succeeded", messages: [fromChannel, answered] })
      expect((yield* ChannelFixture.Outbox).progress).toEqual([{ message: "issue:456", status: "done" }])
      expect((yield* ChannelFixture.Cell).accepted.filter((delivered) => delivered.synthetic)).toEqual([])
    }),
  )

  it.live("a failed turn ends with failed and the fixed notice of its error, never the error text", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const outbox = yield* ChannelFixture.Outbox
      const thread = yield* threadOf(subject)
      const failure = {
        id: "msg_2",
        type: "assistant",
        data: { content: [], error: { type: "provider.rate-limit", message: "429 from api.internal: org_123" } },
      }
      yield* turnEnded(subject, thread.sessionId, { idle: 1, outcome: "failed", messages: [fromChannel, failure] })
      expect(outbox.progress.at(-1)).toEqual({ message: thread.found.message, status: "failed" })
      expect(outbox.sent.map((each) => each.text)).toEqual([
        `I’m temporarily unable to respond. Please try again in a minute. [Open in Ren](${ChannelFixture.app}/sessions/${thread.sessionId})`,
      ])
      expect((yield* ChannelFixture.Cell).accepted.filter((delivered) => delivered.synthetic)).toEqual([])
    }),
  )

  it.live("a start that the brain rejects ends with failed and one notice that links to the chat", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const outbox = yield* ChannelFixture.Outbox
      ;(yield* ChannelFixture.Cell).rejectStarts()
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.settled(found)
      yield* Effect.sync(() => outbox.progress.length).pipe(
        Effect.repeat({ until: (length) => length >= 2, schedule: Schedule.spaced("20 millis") }),
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.die(new Error("The rejected start sent no failure")),
        }),
      )
      const sessionId = (yield* ChannelFixture.threads).at(0)?.current_session_id
      expect(outbox.progress).toEqual([
        { message: found.message, status: "received" },
        { message: found.message, status: "failed" },
      ])
      expect(outbox.sent.map((each) => each.text)).toEqual([
        `I couldn’t start working on your message. Please try again. [Open in Ren](${ChannelFixture.app}/sessions/${sessionId})`,
      ])
    }),
  )

  it.live("a turn that a message from the app started sends nothing to the thread", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const outbox = yield* ChannelFixture.Outbox
      const thread = yield* threadOf(subject)
      const fromApp = { id: "msg_3", type: "user", data: { text: "and from the app", metadata: { userID: "u" } } }
      yield* turnEnded(subject, thread.sessionId, {
        idle: 1,
        outcome: "succeeded",
        messages: [fromChannel, answered, fromApp, { ...answered, id: "msg_4" }],
      })
      expect(outbox.progress).toEqual([{ message: thread.found.message, status: "received" }])
      expect((yield* ChannelFixture.Cell).accepted.filter((delivered) => delivered.synthetic)).toEqual([])
    }),
  )
})

const person = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  options: { readonly inSpace?: Space.ID; readonly email?: string } = {},
) {
  const database = yield* Database.Service
  const seeded = yield* Seed.user(options.email ? { email: options.email } : {})
  yield* Seed.member(organizationId, seeded.id, "member")
  if (options.inSpace)
    yield* database.db
      .insert(Database.Schema.space_member)
      .values({ id: Space.MembershipID.create(), space_id: options.inSpace, user_id: seeded.id })
  return seeded
})

describe("ChannelIdentity", () => {
  it.live("a sign-in link wins over an email match, with no lookup", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const identity = yield* ChannelIdentity.Service
      const outbox = yield* ChannelFixture.Outbox
      const linked = yield* person(subject.owner.organizationId)
      const other = yield* person(subject.owner.organizationId)
      yield* database.db.insert(Database.Schema.account).values({
        id: Auth.AccountID.create(),
        providerId: "slack",
        accountId: "U01",
        userId: linked.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      outbox.emails.set("U01", other.email)
      expect(yield* identity.find(subject.owner.organizationId, ChannelFixture.event(subject.install))).toEqual(
        Option.some(linked.id),
      )
      expect(outbox.lookups).toEqual([])
    }),
  )

  it.live(
    "each mention of an unlinked sender reads their email and matches an organization member; a provider that is down matches no one",
    () =>
      Effect.gen(function* () {
        const subject = yield* routed
        const identity = yield* ChannelIdentity.Service
        const outbox = yield* ChannelFixture.Outbox
        const ana = yield* person(subject.owner.organizationId, { email: "Ana@Acme.test" })
        const stranger = yield* person(yield* Seed.organization(), { email: "bob@acme.test" })
        const event = ChannelFixture.event(subject.install)
        outbox.emails.set("U01", "ana@acme.test")
        expect(yield* identity.find(subject.owner.organizationId, event)).toEqual(Option.some(ana.id))
        expect(yield* identity.find(subject.owner.organizationId, event)).toEqual(Option.some(ana.id))
        outbox.emails.set("U01", "down")
        expect(yield* identity.find(subject.owner.organizationId, event)).toEqual(Option.none())
        expect(outbox.lookups).toEqual(["U01", "U01", "U01"])
        outbox.emails.set("U02", stranger.email)
        expect(
          yield* identity.find(
            subject.owner.organizationId,
            ChannelFixture.event(subject.install, { sender: { accountId: "U02", name: "Bob" } }),
          ),
        ).toEqual(Option.none())
      }),
  )
})

describe("ChannelRoute", () => {
  it.live(
    "a DM starts a chat in the sender's private space, never a shared one; a sender without one, or unknown, is refused",
    () =>
      Effect.gen(function* () {
        const subject = yield* routed
        const database = yield* Database.Service
        const routes = yield* ChannelRoute.Service
        const outbox = yield* ChannelFixture.Outbox
        const member = yield* person(subject.owner.organizationId, { inSpace: subject.owner.spaceId })
        const alone = yield* Seed.space(subject.owner.organizationId)
        yield* Seed.join(alone, member.id)
        const own = Space.ID.create()
        yield* database.db.insert(Database.Schema.space).values({
          id: own,
          organization_id: subject.owner.organizationId,
          kind: "private",
          owner_user_id: member.id,
          slug: "personal-space",
          name: "Personal Space",
        })
        yield* Seed.join(own, member.id)
        outbox.emails.set("U01", member.email)
        const dm = { id: "D01", kind: "dm" } as const
        const found = ChannelFixture.event(subject.install, { place: dm, thread: { id: "D01:1712.33" } })
        expect(yield* routes.resolve(found)).toMatchObject({ spaceId: own, senderUserId: member.id })
        yield* ChannelFixture.receive(ChannelFixture.delivery(found))
        yield* ChannelFixture.settled(found)
        expect(yield* ChannelFixture.accepted(1)).toMatchObject([{ kind: "start" }])
        expect(
          yield* database.db
            .select({ spaceId: Database.Schema.agent_session.space_id })
            .from(Database.Schema.agent_session)
            .innerJoin(
              Database.Schema.intake_thread,
              eq(Database.Schema.intake_thread.current_session_id, Database.Schema.agent_session.id),
            )
            .where(eq(Database.Schema.intake_thread.thread_key, "D01:1712.33")),
        ).toEqual([{ spaceId: own }])
        yield* database.db
          .update(Database.Schema.space)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.space.id, own))
        const refused = (event: Channel.Event) => Effect.flip(routes.resolve(event))
        expect(yield* refused(ChannelFixture.event(subject.install, { place: dm }))).toMatchObject({
          _tag: "ChannelRoute.Refused",
          reason: "no_private_space",
        })
        expect(
          yield* refused(
            ChannelFixture.event(subject.install, { place: dm, sender: { accountId: "U09", name: "Stranger" } }),
          ),
        ).toMatchObject({ _tag: "ChannelRoute.Refused", reason: "unlinked" })
      }),
  )

  it.live("a known sender in the space runs as themself; one outside it runs as the fallback user", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const routes = yield* ChannelRoute.Service
      const outbox = yield* ChannelFixture.Outbox
      const inside = yield* person(subject.owner.organizationId, { inSpace: subject.owner.spaceId })
      const outside = yield* person(subject.owner.organizationId)
      outbox.emails.set("U01", inside.email)
      outbox.emails.set("U02", outside.email)
      expect(yield* routes.resolve(ChannelFixture.event(subject.install))).toMatchObject({ senderUserId: inside.id })
      expect(
        yield* routes.resolve(ChannelFixture.event(subject.install, { sender: { accountId: "U02", name: "Bob" } })),
      ).toMatchObject({ senderUserId: subject.owner.createdBy })
    }),
  )

  it.live("on an unmapped place that anyone can write, an unknown sender is refused, not run as the installer", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const routes = yield* ChannelRoute.Service
      const outbox = yield* ChannelFixture.Outbox
      const member = yield* person(subject.owner.organizationId, { inSpace: subject.owner.spaceId })
      outbox.emails.set("U01", member.email)
      const place = { id: "C07", kind: "channel", name: "eng", anyoneCanWrite: true } as const
      expect(yield* routes.resolve(ChannelFixture.event(subject.install, { place }))).toMatchObject({
        senderUserId: member.id,
      })
      expect(
        yield* Effect.flip(
          routes.resolve(
            ChannelFixture.event(subject.install, { place, sender: { accountId: "U09", name: "Stranger" } }),
          ),
        ),
      ).toMatchObject({ _tag: "ChannelRoute.Refused", reason: "unlinked" })
    }),
  )

  it.live("with no sender that may act and a fallback user outside the space, the event is refused", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const routes = yield* ChannelRoute.Service
      const organizationId = yield* Seed.organization()
      yield* Seed.space(organizationId)
      const installer = yield* person(organizationId)
      const workspace = `T${crypto.randomUUID()}`
      yield* database.db.insert(Database.Schema.channel_install).values({
        id: ChannelInstall.ID.create(),
        organization_id: organizationId,
        provider: "slack",
        workspace,
        name: "Acme",
        installed_by: installer.id,
      })
      expect(yield* Effect.flip(routes.resolve(ChannelFixture.event(workspace)))).toMatchObject({
        _tag: "ChannelRoute.Refused",
        reason: "fallback_gone",
      })
    }),
  )
})

const installOf = Effect.fnUntraced(function* (workspace: string) {
  const database = yield* Database.Service
  const rows = yield* database.db
    .select({ id: Database.Schema.channel_install.id })
    .from(Database.Schema.channel_install)
    .where(eq(Database.Schema.channel_install.workspace, workspace))
  const found = rows.at(0)
  if (!found) return yield* Effect.die(new Error(`No install of ${workspace}`))
  return found.id
})

const sessionOf = Effect.fnUntraced(function* (sessionId: Session.ID | undefined) {
  const database = yield* Database.Service
  return (yield* database.db
    .select({ spaceId: Database.Schema.agent_session.space_id, agentId: Database.Schema.agent_session.agent_id })
    .from(Database.Schema.agent_session)
    .where(eq(Database.Schema.agent_session.id, sessionId ?? Session.ID.create()))).at(0)
})

describe("ChannelMappings", () => {
  it.live("remapping an existing thread starts a new chat in the sender's authorized space", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const mappings = yield* ChannelMappings.Service
      const outbox = yield* ChannelFixture.Outbox
      const owner = { userId: subject.owner.createdBy, organizationId: subject.owner.organizationId, roles: ["owner"] }
      const installId = yield* installOf(subject.install)
      const first = ChannelFixture.event(subject.install)
      yield* mappings.create(owner, { installId, place: first.place.id, spaceId: subject.owner.spaceId })
      yield* ChannelFixture.receive(ChannelFixture.delivery(first))
      yield* ChannelFixture.settled(first)
      const original = (yield* ChannelFixture.accepted(1)).at(0)?.sessionId
      const destination = yield* Seed.space(subject.owner.organizationId)
      yield* Seed.join(destination, subject.owner.createdBy)
      const sender = yield* person(subject.owner.organizationId, { inSpace: destination })
      outbox.emails.set("U02", sender.email)
      yield* mappings.create(owner, { installId, place: first.place.id, spaceId: destination, fallback: false })
      const next = ChannelFixture.event(subject.install, {
        thread: first.thread,
        sender: { accountId: "U02", name: "Bob" },
      })
      yield* ChannelFixture.receive(ChannelFixture.delivery(next))
      yield* ChannelFixture.settled(next)
      const delivered = (yield* ChannelFixture.accepted(2)).at(1)
      expect(delivered?.sessionId).not.toBe(original)
      expect(delivered?.kind).toBe("start")
      expect((yield* sessionOf(delivered?.sessionId))?.spaceId).toBe(destination)
      expect((yield* sessionOf(original))?.spaceId).toBe(subject.owner.spaceId)
    }),
  )

  it.live("a mapped place answers in its space as its agent, and as ren once that agent is archived", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const mappings = yield* ChannelMappings.Service
      const owner = { userId: subject.owner.createdBy, organizationId: subject.owner.organizationId, roles: ["owner"] }
      const eng = yield* Seed.space(subject.owner.organizationId)
      yield* Seed.join(eng, subject.owner.createdBy)
      const triage = yield* Seed.agent({ organizationId: subject.owner.organizationId, spaceId: eng }, "triage", {
        isSubagent: false,
      })
      const installId = yield* installOf(subject.install)
      yield* mappings.create(owner, { installId, place: "C07", spaceId: eng, agentId: triage })
      const first = ChannelFixture.event(subject.install)
      yield* ChannelFixture.receive(ChannelFixture.delivery(first))
      expect(yield* sessionOf((yield* ChannelFixture.accepted(1))[0]?.sessionId)).toEqual({
        spaceId: eng,
        agentId: triage,
      })
      yield* database.db
        .update(Database.Schema.agent)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent.id, triage))
      yield* ChannelFixture.receive(
        ChannelFixture.delivery(ChannelFixture.event(subject.install, { thread: first.thread })),
      )
      expect(yield* sessionOf((yield* ChannelFixture.accepted(2))[1]?.sessionId)).toEqual({
        spaceId: eng,
        agentId: null,
      })
      const next = ChannelFixture.event(subject.install, { thread: first.thread })
      yield* ChannelFixture.receive(ChannelFixture.delivery(next))
      yield* ChannelFixture.settled(next)
      const delivered = yield* ChannelFixture.accepted(3)
      expect(delivered.at(2)?.sessionId).toBe(delivered.at(1)?.sessionId)
      expect(delivered.at(2)?.kind).toBe("send")
    }),
  )

  it.live(
    "an unmapped place goes to the install's default space, and to the oldest active space once it is archived",
    () =>
      Effect.gen(function* () {
        const subject = yield* routed
        const database = yield* Database.Service
        const installs = yield* ChannelInstalls.Service
        const owner = {
          userId: subject.owner.createdBy,
          organizationId: subject.owner.organizationId,
          roles: ["owner"],
        }
        const support = yield* Seed.space(subject.owner.organizationId)
        yield* Seed.join(support, subject.owner.createdBy)
        const installId = yield* installOf(subject.install)
        expect((yield* installs.update(owner, installId, { defaultSpaceId: support })).defaultSpace).toEqual({
          id: support,
          name: "Team",
        })
        yield* ChannelFixture.receive(ChannelFixture.delivery(ChannelFixture.event(subject.install)))
        expect((yield* sessionOf((yield* ChannelFixture.accepted(1))[0]?.sessionId))?.spaceId).toBe(support)
        yield* database.db
          .update(Database.Schema.space)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.space.id, support))
        yield* ChannelFixture.receive(ChannelFixture.delivery(ChannelFixture.event(subject.install)))
        expect((yield* sessionOf((yield* ChannelFixture.accepted(2))[1]?.sessionId))?.spaceId).toBe(
          subject.owner.spaceId,
        )
      }),
  )

  it.live(
    "a mapping of an open place starts with the fallback off: a stranger is refused as unlinked, a member outside the space as not a member",
    () =>
      Effect.gen(function* () {
        const subject = yield* routed
        const mappings = yield* ChannelMappings.Service
        const routes = yield* ChannelRoute.Service
        const outbox = yield* ChannelFixture.Outbox
        const owner = {
          userId: subject.owner.createdBy,
          organizationId: subject.owner.organizationId,
          roles: ["owner"],
        }
        const installId = yield* installOf(subject.install)
        const open = { id: "C11", kind: "channel", name: "shared-with-vendor" } as const
        expect(
          yield* mappings.create(owner, { installId, place: open.id, spaceId: subject.owner.spaceId }),
        ).toMatchObject({ fallback: false, fallbackUser: { id: subject.owner.createdBy } })
        expect(
          yield* mappings.create(owner, { installId, place: "C07", spaceId: subject.owner.spaceId }),
        ).toMatchObject({ fallback: true })
        const outside = yield* person(subject.owner.organizationId)
        outbox.emails.set("U02", outside.email)
        expect(
          yield* Effect.flip(routes.resolve(ChannelFixture.event(subject.install, { place: open }))),
        ).toMatchObject({ reason: "unlinked" })
        expect(
          yield* Effect.flip(
            routes.resolve(
              ChannelFixture.event(subject.install, { place: open, sender: { accountId: "U02", name: "Bob" } }),
            ),
          ),
        ).toMatchObject({ reason: "not_member" })
      }),
  )

  it.live(
    "a new mapping, or one that moves to another space, posts one notice; the same request again gives the same mapping and posts nothing",
    () =>
      Effect.gen(function* () {
        const subject = yield* routed
        const mappings = yield* ChannelMappings.Service
        const database = yield* Database.Service
        const outbox = yield* ChannelFixture.Outbox
        const owner = {
          userId: subject.owner.createdBy,
          organizationId: subject.owner.organizationId,
          roles: ["owner"],
        }
        const installId = yield* installOf(subject.install)
        const sales = yield* Seed.space(subject.owner.organizationId)
        yield* Seed.join(sales, subject.owner.createdBy)
        yield* database.db
          .update(Database.Schema.space)
          .set({ name: "Sales" })
          .where(eq(Database.Schema.space.id, sales))
        const input = { installId, place: "C07", spaceId: subject.owner.spaceId }
        const first = yield* mappings.create(owner, input)
        expect(yield* mappings.create(owner, input)).toMatchObject({ id: first.id, space: first.space })
        const moved = yield* mappings.create(owner, { ...input, spaceId: sales })
        expect(moved.id).toBe(first.id)
        expect(outbox.announced).toEqual([
          { place: "C07", text: "Ren answers here for Team." },
          { place: "C07", text: "Ren answers here for Sales." },
        ])
      }),
  )

  it.live("only a member of the target space maps a place, and the fallback user must be a member of it", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const mappings = yield* ChannelMappings.Service
      const installId = yield* installOf(subject.install)
      const inside = yield* person(subject.owner.organizationId, { inSpace: subject.owner.spaceId })
      const outside = yield* person(subject.owner.organizationId)
      const actor = (user: { readonly id: Auth.UserID }) => ({
        userId: user.id,
        organizationId: subject.owner.organizationId,
        roles: ["member"],
      })
      const input = { installId, place: "C07", spaceId: subject.owner.spaceId }
      expect(yield* Effect.flip(mappings.create(actor(outside), input))).toMatchObject({ _tag: "Primitive.Forbidden" })
      expect(
        yield* Effect.flip(mappings.create(actor(inside), { ...input, fallbackUserId: outside.id })),
      ).toMatchObject({ _tag: "Primitive.Invalid", field: "fallbackUserId" })
      const mapped = yield* mappings.create(actor(inside), input)
      expect(
        yield* mappings.create(actor(inside), { ...input, fallback: false, fallbackUserId: outside.id }),
      ).toMatchObject({
        id: mapped.id,
        fallback: false,
      })
      expect(yield* Effect.flip(mappings.remove(actor(outside), mapped.id, {}))).toMatchObject({
        _tag: "Primitive.Forbidden",
      })
      yield* mappings.remove(actor(inside), mapped.id, {})
      expect(
        (yield* mappings.places(actor(outside), { installId, page: 1, pageSize: 100 })).items.map((place) => ({
          name: place.name,
          mapped: place.mapping !== null,
        })),
      ).toEqual([
        { name: "eng", mapped: false },
        { name: "sales", mapped: false },
        { name: "shared-with-vendor", mapped: false },
      ])
    }),
  )

  it.live(
    "a trigger runs only where a mapping turned it on, with the mapping's prompt; a refused trigger posts nothing",
    () =>
      Effect.gen(function* () {
        const subject = yield* routed
        const mappings = yield* ChannelMappings.Service
        const outbox = yield* ChannelFixture.Outbox
        const owner = {
          userId: subject.owner.createdBy,
          organizationId: subject.owner.organizationId,
          roles: ["owner"],
        }
        const installId = yield* installOf(subject.install)
        const triggered = (place: { readonly id: string; readonly name: string }) =>
          ChannelFixture.event(subject.install, {
            place: { ...place, kind: "channel" },
            text: ChannelFixture.trigger.defaultPrompt,
            trigger: ChannelFixture.trigger.id,
          })
        expect(
          yield* Effect.flip(
            mappings.create(owner, {
              installId,
              place: "C07",
              spaceId: subject.owner.spaceId,
              triggers: [{ id: "pull_request_ready" }],
            }),
          ),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "triggers" })
        yield* mappings.create(owner, { installId, place: "C07", spaceId: subject.owner.spaceId })
        const off = [triggered({ id: "C07", name: "eng" }), triggered({ id: "C09", name: "sales" })]
        yield* Effect.forEach(off, (found) =>
          ChannelFixture.receive(ChannelFixture.delivery(found)).pipe(Effect.andThen(ChannelFixture.settled(found))),
        )
        expect(outbox.progress).toEqual([])
        yield* mappings.create(owner, {
          installId,
          place: "C07",
          spaceId: subject.owner.spaceId,
          triggers: [{ id: ChannelFixture.trigger.id, prompt: "Summarise the thread." }],
        })
        const on = triggered({ id: "C07", name: "eng" })
        yield* ChannelFixture.receive(ChannelFixture.delivery(on))
        expect(yield* ChannelFixture.accepted(1)).toMatchObject([
          { prompt: { text: "Summarise the thread." }, channel: { trigger: ChannelFixture.trigger.title } },
        ])
        yield* mappings.create(owner, {
          installId,
          place: "C11",
          spaceId: subject.owner.spaceId,
          triggers: [{ id: ChannelFixture.trigger.id }],
        })
        const refused = triggered({ id: "C11", name: "shared-with-vendor" })
        yield* ChannelFixture.receive(ChannelFixture.delivery(refused))
        yield* ChannelFixture.settled(refused)
        expect(outbox.progress).toEqual([{ message: on.message, status: "received" }])
        expect(outbox.sent).toEqual([])
      }),
  )
})

const permalink = "https://acme.slack.com/archives/C07/p1712000000000100"

const tasked = Effect.gen(function* () {
  const subject = yield* routed
  const tasks = yield* Task.Service
  const owner = { userId: subject.owner.createdBy, organizationId: subject.owner.organizationId, roles: ["owner"] }
  const spaceId = yield* Seed.space(subject.owner.organizationId)
  yield* Seed.join(spaceId, subject.owner.createdBy)
  const agent = (name: string) =>
    Seed.agent({ organizationId: subject.owner.organizationId, spaceId }, name, { isSubagent: false })
  const build = yield* agent("build")
  const task = yield* tasks.create(owner, { spaceId, title: "Fix the deploy", agentId: build, links: [permalink] })
  const mappings = yield* ChannelMappings.Service
  yield* mappings.create(owner, {
    installId: yield* installOf(subject.install),
    place: "C07",
    spaceId: subject.owner.spaceId,
    fallback: true,
  })
  const found = ChannelFixture.event(subject.install, { thread: { id: "C07:1712000000.000100", url: permalink } })
  return { subject, owner, spaceId, agent, build, task, found }
})

const linkAccount = Effect.fnUntraced(function* (accountId: string, userId: Auth.UserID) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.account).values({
    id: Auth.AccountID.create(),
    providerId: "slack",
    accountId,
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

const mentioned = (setup: Effect.Success<typeof tasked>, accountId: string, text: ReadonlyArray<string>) =>
  JSON.stringify({
    type: "signal",
    signal: {
      kind: "mentioned",
      install: setup.subject.install,
      link: { kind: "github_pr", key: "acme/web#52" },
      url: "https://github.com/acme/web/pull/52",
      sender: { accountId },
      text: text.join("\n"),
    },
  })

const taskSession = Effect.fnUntraced(function* (
  setup: Effect.Success<typeof tasked>,
  agentId: Agent.ID = setup.build,
) {
  const database = yield* Database.Service
  const sessionId = yield* Seed.session({ ...setup.subject.owner, spaceId: setup.spaceId })
  yield* database.db
    .insert(Database.Schema.task_session)
    .values({ task_id: setup.task.id, session_id: sessionId, agent_id: agentId })
  ;(yield* ChannelFixture.Cell).start(sessionId)
  return sessionId
})

describe("Channels and tasks", () => {
  it.live("a message on a thread that one open task links goes to the task agent's latest session", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const sessionId = yield* taskSession(setup)
      yield* ChannelFixture.thread(setup.subject.owner.organizationId, setup.found, yield* started(setup.subject.owner))
      yield* ChannelFixture.receive(ChannelFixture.delivery(setup.found))
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([
        { kind: "send", sessionId, delivery: "steer", prompt: { text: setup.found.text } },
      ])
      expect(yield* ChannelFixture.threads).toMatchObject([{ current_session_id: sessionId }])
    }),
  )

  it.live("after a handoff, the message and task context start one non-interactive turn for the new agent", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const tasks = yield* Task.Service
      yield* taskSession(setup)
      const review = yield* setup.agent("review")
      yield* tasks.assign(setup.owner, setup.task.id, { agentId: review, start: "none" })
      yield* ChannelFixture.receive(ChannelFixture.delivery(setup.found))
      yield* ChannelFixture.settled(setup.found)
      const accepted = yield* ChannelFixture.accepted(1)
      expect(accepted[0]?.prompt.text).toContain("<task_context")
      expect(accepted).toMatchObject([
        { kind: "start", interactive: false, prompt: { text: expect.stringContaining(setup.found.text) } },
      ])
      expect(accepted).toHaveLength(1)
      expect(yield* sessionOf(accepted[0]?.sessionId)).toEqual({ spaceId: setup.spaceId, agentId: review })
      expect(yield* ChannelFixture.threads).toMatchObject([{ current_session_id: accepted[0]?.sessionId }])
      const after = yield* tasks.get(setup.owner, setup.task.id)
      expect({ status: after.status, session: after.session?.id }).toEqual({
        status: "todo",
        session: accepted[0]?.sessionId,
      })
    }),
  )

  it.live("an unusable agent does not make two linked tasks unambiguous", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const tasks = yield* Task.Service
      const database = yield* Database.Service
      const other = yield* setup.agent("other")
      yield* tasks.create(setup.owner, { spaceId: setup.spaceId, title: "Other", agentId: other, links: [permalink] })
      yield* database.db
        .update(Database.Schema.agent)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent.id, other))
      const routes = yield* ChannelRoute.Service
      expect((yield* routes.resolve(setup.found)).task).toBeUndefined()
    }),
  )

  it.live("an unmapped linked thread cannot borrow the installer's identity", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const routes = yield* ChannelRoute.Service
      expect(
        yield* Effect.flip(
          routes.resolve(
            ChannelFixture.event(setup.subject.install, {
              thread: setup.found.thread,
              place: { id: "C09", kind: "channel" },
            }),
          ),
        ),
      ).toMatchObject({ reason: "unlinked" })
    }),
  )

  it.live("two open tasks on one thread, or one task with no agent, leave the thread to normal routing", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const tasks = yield* Task.Service
      const second = yield* tasks.create(setup.owner, {
        spaceId: setup.spaceId,
        title: "Write the postmortem",
        agentId: setup.build,
        links: [permalink],
      })
      yield* ChannelFixture.receive(ChannelFixture.delivery(setup.found))
      expect((yield* ChannelFixture.accepted(1))[0]?.prompt).toEqual({ text: setup.found.text })
      yield* tasks.assign(setup.owner, second.id, { agentId: null })
      yield* tasks.assign(setup.owner, setup.task.id, { agentId: null })
      const next = ChannelFixture.event(setup.subject.install, { thread: setup.found.thread })
      yield* ChannelFixture.receive(ChannelFixture.delivery(next))
      const accepted = yield* ChannelFixture.accepted(2)
      expect(accepted.map((each) => each.kind)).toEqual(["start", "send"])
      expect(accepted[1]?.sessionId).toBe(accepted[0]?.sessionId)
    }),
  )

  it.live("the sender is checked against the task's space, with the mapping's fallback", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const mappings = yield* ChannelMappings.Service
      const routes = yield* ChannelRoute.Service
      const outbox = yield* ChannelFixture.Outbox
      const installId = yield* installOf(setup.subject.install)
      yield* mappings.create(setup.owner, {
        installId,
        place: "C07",
        spaceId: setup.subject.owner.spaceId,
        fallback: false,
      })
      const mapped = yield* person(setup.subject.owner.organizationId, { inSpace: setup.subject.owner.spaceId })
      const worker = yield* person(setup.subject.owner.organizationId, { inSpace: setup.spaceId })
      outbox.emails.set("U01", mapped.email)
      outbox.emails.set("U02", worker.email)
      expect(yield* Effect.flip(routes.resolve(setup.found))).toMatchObject({ reason: "not_member" })
      const fromWorker = ChannelFixture.event(setup.subject.install, {
        thread: setup.found.thread,
        sender: { accountId: "U02", name: "Bob" },
      })
      expect(yield* routes.resolve(fromWorker)).toMatchObject({
        spaceId: setup.spaceId,
        agentId: setup.build,
        senderUserId: worker.id,
      })
    }),
  )

  it.live("a message that cannot be handed to the task's agent posts one notice and starts no other chat", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      yield* taskSession(setup)
      const before = (yield* sessionsOf(setup.subject.owner)).length
      ;(yield* ChannelFixture.Cell).rejectSends()
      yield* ChannelFixture.receive(ChannelFixture.delivery(setup.found))
      yield* ChannelFixture.settled(setup.found)
      expect((yield* ChannelFixture.Outbox).sent.map((sent) => sent.text)).toEqual([
        "Couldn’t hand this message to the task’s agent. Try again in a moment.",
      ])
      expect(yield* sessionsOf(setup.subject.owner)).toHaveLength(before)
    }),
  )

  it.live("a pull request that names tasks by ID, by branch or by task URL links each one once, as its sender", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const tasks = yield* Task.Service
      const database = yield* Database.Service
      yield* linkAccount("U01", setup.owner.userId)
      const byUrl = yield* tasks.create(setup.owner, { spaceId: setup.spaceId, title: "Named by URL" })
      const byId = yield* tasks.create(setup.owner, { spaceId: setup.spaceId, title: "Named by ID" })
      const unnamed = yield* tasks.create(setup.owner, { spaceId: setup.spaceId, title: "Not named" })
      const prefix = setup.task.identifier.slice(0, setup.task.identifier.lastIndexOf("-"))
      const pull = "https://github.com/acme/web/pull/52"
      const mention = mentioned(setup, "U01", [
        `${setup.task.identifier.toLowerCase()}-fix-deploy`,
        `Fix the deploy, see ${ChannelFixture.app}/tasks/${byUrl.id}`,
        `Closes ${byId.identifier}. Not X${prefix}-${unnamed.number}, not ${prefix}-${unnamed.number}0, not OTHER-${unnamed.number}.`,
      ])
      expect(yield* ChannelFixture.receive(mention)).toEqual({ status: 200 })
      expect(yield* ChannelFixture.receive(mention)).toEqual({ status: 200 })
      const after = yield* Effect.forEach([setup.task.id, byUrl.id, byId.id, unnamed.id], (id) =>
        tasks.get(setup.owner, id),
      )
      expect(after.map((task) => task.links.some((link) => link.url === pull))).toEqual([true, true, true, false])
      const linked = yield* database.db
        .select({
          taskId: Database.Schema.task_event.task_id,
          data: Database.Schema.task_event.data,
          userId: Database.Schema.task_event.actor_user_id,
        })
        .from(Database.Schema.task_event)
        .where(
          and(
            eq(Database.Schema.task_event.kind, "link"),
            inArray(Database.Schema.task_event.task_id, [setup.task.id, byUrl.id, byId.id, unnamed.id]),
            sql`${Database.Schema.task_event.data} ->> 'added' like '%/pull/52%'`,
          ),
        )
        .orderBy(Database.Schema.task_event.task_id)
      expect(linked).toEqual(
        [setup.task.id, byUrl.id, byId.id].toSorted().map((taskId) => ({
          taskId,
          data: { _tag: "link", added: [pull], removed: [] },
          userId: setup.owner.userId,
        })),
      )
    }),
  )

  it.live(
    "a mention links nothing for a sender with no Ren account or who cannot update the task; Ren's own bot links it",
    () =>
      Effect.gen(function* () {
        const setup = yield* tasked
        const tasks = yield* Task.Service
        const database = yield* Database.Service
        const outsider = yield* Seed.actor(setup.subject.owner.organizationId, "member")
        yield* linkAccount("U02", outsider.userId)
        yield* database.db
          .update(Database.Schema.channel_install)
          .set({ bot_user: "B01" })
          .where(eq(Database.Schema.channel_install.workspace, setup.subject.install))
        const named = [`Fixes ${setup.task.identifier}`]
        const links = () =>
          tasks.get(setup.owner, setup.task.id).pipe(Effect.map((task) => task.links.map((link) => link.url)))
        expect(yield* ChannelFixture.receive(mentioned(setup, "U09", named))).toEqual({ status: 200 })
        expect(yield* ChannelFixture.receive(mentioned(setup, "U02", named))).toEqual({ status: 200 })
        expect(yield* links()).toEqual([permalink])
        expect(yield* ChannelFixture.receive(mentioned(setup, "B01", named))).toEqual({ status: 200 })
        expect(yield* links()).toEqual([permalink, "https://github.com/acme/web/pull/52"])
      }),
  )

  it.live("a pull request event whose mention fails is not acknowledged, and its turn does not start", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      yield* linkAccount("U01", setup.owner.userId)
      const signal = {
        kind: "mentioned",
        install: setup.subject.install,
        link: { kind: "github_pr", key: "acme/web#53" },
        url: "https://github.com/acme/web/pull/53\u0000",
        sender: { accountId: "U01" },
        text: `Fixes ${setup.task.identifier}`,
      }
      const before = (yield* sessionsOf(setup.subject.owner)).length
      expect(yield* ChannelFixture.receive(JSON.stringify({ type: "event", event: setup.found, signal }))).toEqual({
        status: 500,
      })
      expect(yield* sessionsOf(setup.subject.owner)).toHaveLength(before)
    }),
  )

  it.live("a merged pull request sets each open task that links it to done once, with GitHub in the trail", () =>
    Effect.gen(function* () {
      const setup = yield* tasked
      const tasks = yield* Task.Service
      const database = yield* Database.Service
      const pull = "https://github.com/acme/web/pull/41"
      const open = yield* tasks.update(setup.owner, setup.task.id, { addLinks: [`${pull}/files`] })
      yield* tasks.review(setup.owner, open.id, { humanReview: true, reason: "Ready to merge." })
      const closed = yield* tasks.create(setup.owner, {
        spaceId: setup.spaceId,
        title: "Old attempt",
        status: "dismissed",
        links: [pull],
      })
      const signal = JSON.stringify({
        type: "signal",
        signal: {
          kind: "pull_request_merged",
          install: setup.subject.install,
          link: { kind: "github_pr", key: "acme/web#41" },
          url: pull,
        },
      })
      expect(yield* ChannelFixture.receive(signal)).toEqual({ status: 200 })
      expect(yield* ChannelFixture.receive(signal)).toEqual({ status: 200 })
      const after = yield* Effect.forEach([open.id, closed.id], (id) => tasks.get(setup.owner, id))
      expect(after.map((task) => [task.status, task.humanReview])).toEqual([
        ["done", false],
        ["dismissed", false],
      ])
      expect(
        yield* database.db
          .select({
            taskId: Database.Schema.task_event.task_id,
            data: Database.Schema.task_event.data,
            userId: Database.Schema.task_event.actor_user_id,
          })
          .from(Database.Schema.task_event)
          .where(
            and(
              eq(Database.Schema.task_event.kind, "status"),
              inArray(Database.Schema.task_event.task_id, [open.id, closed.id]),
            ),
          ),
      ).toEqual([
        {
          taskId: open.id,
          data: {
            _tag: "status",
            from: "todo",
            to: "done",
            automation: { provider: "github", cause: "pull_request_merged", url: pull },
          },
          userId: null,
        },
      ])
    }),
  )
})

const onBrains = testEffect(ChannelFixture.sandboxLayer)

describe("Channels on brains", () => {
  onBrains.live("a failed brain stops the run: 👀 becomes a failure and one fixed notice links to the chat", () =>
    Effect.gen(function* () {
      const subject = yield* routed
      const database = yield* Database.Service
      const outbox = yield* ChannelFixture.Outbox
      const sessionId = yield* Seed.session(subject.owner)
      yield* database.db
        .update(Database.Schema.brain)
        .set({ phase: "failed", failures: 3, failure: "the template is broken" })
        .where(eq(Database.Schema.brain.id, Brain.ofSession(sessionId)))
      const found = ChannelFixture.event(subject.install)
      yield* ChannelFixture.thread(subject.owner.organizationId, found, sessionId)
      yield* ChannelFixture.receive(ChannelFixture.delivery(found))
      yield* ChannelFixture.settled(found)
      expect(outbox.progress).toEqual([
        { message: found.message, status: "received" },
        { message: found.message, status: "failed" },
      ])
      expect(outbox.sent).toEqual([
        {
          target: { install: found.install, place: "eng", thread: found.thread.id, message: found.message },
          text: `I couldn’t start working on your message. Please try again. [Open in Ren](${ChannelFixture.app}/sessions/${sessionId})`,
        },
      ])
    }),
  )
})

describe("ChannelEventRun", () => {
  it.live("a ChannelEvent run that Ren stored before Intake starts its chat through the Intake queue", () =>
    Effect.gen(function* () {
      const found = ChannelFixture.event((yield* routed).install)
      yield* DurableRunner.ensure(ChannelEventRun.Run, {
        event: found,
        messageId: Session.MessageID.create(),
        sessionId: Session.ID.create(),
      })
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([{ kind: "start", prompt: { text: found.text } }])
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
