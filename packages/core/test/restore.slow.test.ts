import { expect, setDefaultTimeout } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { Shared, type StubModel, TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { SessionMessage } from "@ren/schema/session/message"
import { eq } from "drizzle-orm"
import { Effect, Fiber, Layer, Schedule, Schema } from "effect"
import { Access } from "../src/access.js"
import { BrainClient } from "../src/brain-client.js"
import { BrainHost } from "../src/brain-host.js"
import { BrainRegistry } from "../src/brain-registry.js"
import { Brains } from "../src/brains.js"
import { Models } from "../src/models.js"
import { SandboxProvider } from "../src/sandbox-provider.js"
import { Session } from "../src/session.js"
import { SessionRunner } from "../src/session/runner.js"
import { TranscriptCodec } from "../src/transcript-codec.js"
import { testEffect } from "./lib/effect.js"
import { HarnessDb } from "./lib/harness-db.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(120_000)

const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, stub.url)

const fixed = Layer.succeed(
  Models.Service,
  Models.Service.of({
    inference: Shared.inference(),
    revision: Effect.succeed("test"),
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
  }),
)

const it = testEffect(
  Session.layer.pipe(
    Layer.provideMerge(SessionRunner.layer),
    Layer.provideMerge(BrainRegistry.layer),
    Layer.provideMerge(TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } })),
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Host.layerSynced({}, fixed)),
    Layer.provideMerge(fixed),
    Layer.provideMerge(Testing.layer),
  ),
)

const subagent = (child: StubModel.Script) =>
  stub.script({
    tool: { name: "subagent", input: { agent: "general", description: "Look", prompt: `${child.marker} look` } },
  })

const Page = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) })
const Children = Schema.Array(Schema.Struct({ id: Schema.String }))

const opened = Effect.fnUntraced(function* (text: string) {
  const sessions = yield* SessionRunner.Service
  const brains = yield* Brains.Service
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const sessionId = Session.ID.create()
  const messageId = Session.MessageID.create()
  yield* sessions.create(owner, {
    sessionId,
    harness: "opencode",
    interactive: true,
    initialMessage: { messageId, prompt: { text }, sender: { userId: owner.createdBy } },
  })
  const brainId = (yield* database.db
    .select({ brainId: Database.Schema.agent_session.brain_id })
    .from(Database.Schema.agent_session)
    .where(eq(Database.Schema.agent_session.id, sessionId))).at(0)?.brainId
  if (!brainId) return yield* Effect.die(new Error("The chat has no brain"))
  const access = yield* Host.ready(brains.access(sessionId, { userId: owner.createdBy }))
  const chat = (path: string, init: RequestInit = {}) =>
    Effect.tryPromise(() =>
      fetch(`${access.url}/chat/session/${sessionId}${path}`, {
        ...init,
        headers: { authorization: TestToken.basic(access.token), "content-type": "application/json" },
      }),
    ).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.promise(() => (response.status === 204 ? Promise.resolve(null) : response.json()))
          : Effect.fail(new Error(`${path} answered ${response.status}`)),
      ),
      Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
      Effect.orDie,
    )
  const idle = Effect.tryPromise(() =>
    fetch(`${access.url}/chat/status`, { headers: { authorization: TestToken.basic(access.token) } }).then((response) =>
      response.json(),
    ),
  ).pipe(
    Effect.map((body) => Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(body)),
    Effect.repeat({ until: (status) => Object.keys(status).length === 0, schedule: Schedule.spaced("100 millis") }),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
    Effect.orDie,
  )
  const synced = brains
    .flush(sessionId)
    .pipe(Effect.orDie, Effect.repeat({ until: (flushed) => flushed.drained, schedule: Schedule.spaced("100 millis") }))
  const read = Effect.all({
    messages: chat("/message?limit=200").pipe(Effect.map((body) => Schema.decodeUnknownSync(Page)(body).items)),
    children: chat("/children").pipe(Effect.map((body) => Schema.decodeUnknownSync(Children)(body))),
  }).pipe(
    Effect.map((found) => ({
      messages: found.messages.map((each) => each.id),
      children: found.children.map((each) => each.id).toSorted(),
    })),
  )
  const raw = (path: string, init: RequestInit = {}) =>
    Effect.promise(async () => {
      const response = await fetch(`${access.url}/chat/session/${sessionId}${path}`, {
        ...init,
        headers: { authorization: TestToken.basic(access.token), "content-type": "application/json" },
      })
      return { status: response.status, body: Schema.decodeUnknownSync(Schema.Json)(await response.json()) }
    })
  const provider = yield* SandboxProvider.Service
  const home = Schema.decodeUnknownSync(Schema.Struct({ home: Schema.String }))(
    (yield* provider.list.pipe(Effect.orDie)).find((each) => each.brainId === brainId)?.binding,
  ).home
  return { sessionId, messageId, brainId, owner, home, chat, raw, idle, synced, read }
})

it.live(
  "a chat with two subagent chats, synced, then its harness database lost: the first read restores the whole history and both subagent chats",
  () =>
    Effect.gen(function* () {
      const first = stub.script()
      const second = stub.script()
      const chat = yield* opened(`open ${subagent(first).marker}`)
      yield* Effect.promise(() => first.called())
      yield* chat.idle
      yield* chat.chat("/prompt", {
        method: "POST",
        body: JSON.stringify({ id: SessionMessage.ID.create(), text: subagent(second).marker, delivery: "steer" }),
      })
      yield* Effect.promise(() => second.called())
      yield* chat.idle
      const before = yield* chat.read
      expect(before.children).toHaveLength(2)
      yield* chat.synced
      yield* Host.forgetHarness(chat.brainId)
      expect(yield* chat.read).toEqual(before)
    }),
)

it.live(
  "a prompt and a session read sent at once to a chat that needs a restore: one restore runs, and the prompt comes after the restored history",
  () =>
    Effect.gen(function* () {
      const outage = yield* Host.Outage
      const first = stub.script()
      const chat = yield* opened(`open ${first.marker}`)
      yield* Effect.promise(() => first.called())
      yield* chat.idle
      const before = yield* chat.read
      yield* chat.synced
      yield* Host.forgetHarness(chat.brainId)
      yield* chat.idle
      const asked = outage.paths.length
      const next = SessionMessage.ID.create()
      const reply = stub.script()
      yield* Effect.all(
        [
          chat.chat("/prompt", {
            method: "POST",
            body: JSON.stringify({ id: next, text: reply.marker, delivery: "steer" }),
          }),
          chat.chat(""),
        ],
        { concurrency: "unbounded" },
      )
      yield* Effect.promise(() => reply.called())
      yield* chat.idle
      const after = (yield* chat.read).messages
      expect(after.slice(-before.messages.length)).toEqual(before.messages)
      expect(after.filter((id) => id === next)).toHaveLength(1)
      expect(after.indexOf(next)).toBeLessThan(after.length - before.messages.length)
      expect(outage.paths.slice(asked).filter((path) => path === "/host/sync/restore")).toHaveLength(1)
    }),
)

it.live(
  "Ren unreachable during a restore: the request gets 503 with a retry time and the restore flag stays; with Ren back the next request restores",
  () =>
    Effect.gen(function* () {
      const outage = yield* Host.Outage
      const script = stub.script()
      const chat = yield* opened(`open ${script.marker}`)
      yield* Effect.promise(() => script.called())
      yield* chat.idle
      const before = yield* chat.read
      yield* chat.synced
      yield* Host.forgetHarness(chat.brainId)
      yield* chat.idle
      outage.fail((path) => path.endsWith("/messages"))
      expect(yield* chat.raw("/message")).toMatchObject({
        status: 503,
        body: { _tag: "UnavailableError", retryAfterMs: 2000 },
      })
      expect(HarnessDb.brainKey(chat.home, "ren:restoring")).toContain(chat.sessionId)
      outage.clear()
      expect(yield* chat.read).toEqual(before)
      expect(HarnessDb.brainKey(chat.home, "ren:restoring")).not.toContain(chat.sessionId)
    }),
)

it.live(
  "a brain killed between the imports of two subagent chats copies only the missing chat at the next request, with no message twice",
  () =>
    Effect.gen(function* () {
      const outage = yield* Host.Outage
      const first = stub.script()
      const second = stub.script()
      const chat = yield* opened(`open ${subagent(first).marker}`)
      yield* Effect.promise(() => first.called())
      yield* chat.idle
      yield* chat.chat("/prompt", {
        method: "POST",
        body: JSON.stringify({ id: SessionMessage.ID.create(), text: subagent(second).marker, delivery: "steer" }),
      })
      yield* Effect.promise(() => second.called())
      yield* chat.idle
      const before = yield* chat.read
      const later = before.children[1]
      if (!later) return yield* Effect.die(new Error("The chat has no second subagent chat"))
      yield* chat.synced
      yield* Host.forgetHarness(chat.brainId)
      yield* chat.idle
      const pages = (id: string) => `/host/sync/sessions/${id}/messages`
      const held = outage.hold((path) => path === pages(later))
      const reading = yield* chat.read.pipe(Effect.forkChild)
      yield* Effect.promise(() => held.entered)
      yield* Host.restart(chat.brainId, () => Promise.resolve())
      held.release()
      expect(yield* Fiber.join(reading)).toEqual(before)
      expect(
        [chat.sessionId, ...before.children].map((id) => outage.paths.filter((path) => path === pages(id)).length),
      ).toEqual([1, 1, 2])
    }),
)

it.live(
  "a chat whose root never committed in Ren but whose subagent chat did: the root starts from its start input, then the subagent chat is imported",
  () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const child = stub.script()
      const chat = yield* opened(`open ${subagent(child).marker}`)
      yield* Effect.promise(() => child.called())
      yield* chat.idle
      const before = yield* chat.read
      yield* chat.synced
      yield* database.db
        .delete(Database.Schema.opencode_message)
        .where(eq(Database.Schema.opencode_message.session_id, chat.sessionId))
      yield* database.db
        .delete(Database.Schema.opencode_session)
        .where(eq(Database.Schema.opencode_session.session_id, chat.sessionId))
      yield* Host.forgetHarness(chat.brainId)
      const after = yield* chat.read
      expect(after.children).toEqual(before.children)
      expect(after.messages).toContain(chat.messageId)
    }),
)

it.live("a chat that was busy when its brain was lost restores idle, and Ren shows it idle after the next sync", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const script = stub.script({ hold: true })
    yield* Effect.addFinalizer(() => Effect.sync(script.release))
    const chat = yield* opened(`open ${script.marker}`)
    yield* Effect.promise(() => script.called())
    const suspended = database.db
      .select({ at: Database.Schema.opencode_session.time_suspended })
      .from(Database.Schema.opencode_session)
      .where(eq(Database.Schema.opencode_session.session_id, chat.sessionId))
      .pipe(Effect.map((rows) => rows.at(0)?.at ?? null))
    yield* suspended.pipe(
      Effect.repeat({ until: (at) => at !== null, schedule: Schedule.spaced("100 millis") }),
      Effect.timeout("30 seconds"),
    )
    yield* Host.forgetHarness(chat.brainId)
    script.release()
    yield* chat.read
    yield* chat.idle
    yield* chat.synced
    expect(yield* suspended).toBeNull()
  }),
)

it.live(
  "on a new sandbox the first request is a prompt to a chat that needs a restore: without Ren's settings it gets 503 and no turn starts; with them the turn runs with the chat's agent, in its own folder",
  () =>
    Effect.gen(function* () {
      const outage = yield* Host.Outage
      const instructions = `Ren says ${crypto.randomUUID()}`
      yield* Seed.ren({ instructions })
      const first = stub.script()
      const chat = yield* opened(`open ${first.marker}`)
      yield* Effect.promise(() => first.called())
      yield* chat.idle
      yield* chat.synced
      outage.fail((path) => path === "/host/pull")
      yield* Host.restart(chat.brainId, (home) =>
        Promise.all(
          [
            ...["", "-wal", "-shm"].map((suffix) => join(home, ".ren", `opencode.db${suffix}`)),
            join(home, "workspace", chat.sessionId),
          ].map((path) => rm(path, { recursive: true, force: true })),
        ).then(() => HarnessDb.deleteBrainKeys(home, ["ren:settings-layers", "ren:chats", "ren:chat-settings"])),
      )
      yield* chat.idle
      const reply = stub.script({
        tool: { name: "read", input: { path: join(chat.home, "workspace", "ses_other", "f.txt") } },
      })
      const prompt = {
        method: "POST",
        body: JSON.stringify({ id: SessionMessage.ID.create(), text: reply.marker, delivery: "steer" }),
      }
      expect(yield* chat.raw("/prompt", prompt)).toMatchObject({ status: 503, body: { _tag: "UnavailableError" } })
      expect(reply.calls).toHaveLength(0)
      outage.clear()
      expect((yield* chat.raw("/prompt", prompt)).status).toBe(200)
      const answered = yield* Effect.promise(() => reply.called(2))
      expect(answered.system).toContain(instructions)
      expect(JSON.stringify(answered.body.messages.findLast((message) => message.role === "tool")?.content)).toContain(
        "its own folder",
      )
    }),
)

it.live(
  "a chat with no transcript in Ren restores as a start: its first message comes back once, and its tools run in its folder on the brain's own hand",
  () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const script = stub.script()
      const chat = yield* opened(`open ${script.marker}`)
      yield* Effect.promise(() => script.called())
      yield* chat.idle
      yield* chat.synced
      yield* database.db
        .delete(Database.Schema.opencode_message)
        .where(eq(Database.Schema.opencode_message.session_id, chat.sessionId))
      yield* database.db
        .delete(Database.Schema.opencode_session)
        .where(eq(Database.Schema.opencode_session.session_id, chat.sessionId))
      yield* Host.forgetHarness(chat.brainId)
      yield* chat.read
      yield* Effect.promise(() => script.called(2))
      yield* chat.idle
      expect((yield* chat.read).messages.filter((id) => id === chat.messageId)).toHaveLength(1)
      const shell = stub.script({ tool: { name: "shell", input: { command: "pwd" } } })
      yield* chat.chat("/prompt", {
        method: "POST",
        body: JSON.stringify({ id: SessionMessage.ID.create(), text: shell.marker, delivery: "steer" }),
      })
      const answered = yield* Effect.promise(() => shell.called(2))
      expect(JSON.stringify(answered.body.messages.findLast((message) => message.role === "tool")?.content)).toContain(
        `/workspace/${chat.sessionId}`,
      )
    }),
)

it.live("queued messages of a chat come back with it, in order, after its harness database is lost", () =>
  Effect.gen(function* () {
    const script = stub.script()
    const chat = yield* opened(`open ${script.marker}`)
    yield* Effect.promise(() => script.called())
    yield* chat.idle
    const queued = [SessionMessage.ID.create(), SessionMessage.ID.create()]
    yield* Effect.forEach(queued, (id, index) =>
      chat.chat("/prompt", {
        method: "POST",
        body: JSON.stringify({ id, text: `later ${index}`, delivery: "queue", resume: false }),
      }),
    )
    const inbox = chat.chat("/inbox").pipe(
      Effect.map((body) => Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(body)),
      Effect.map((items) => items.map((item) => item.id)),
    )
    expect(yield* inbox).toEqual(queued)
    yield* chat.synced
    yield* Host.forgetHarness(chat.brainId)
    expect(yield* inbox).toEqual(queued)
  }),
)

it.live("a staged revert stays staged after a restore, and clearing it brings the hidden messages back", () =>
  Effect.gen(function* () {
    const first = stub.script()
    const chat = yield* opened(`open ${first.marker}`)
    yield* Effect.promise(() => first.called())
    yield* chat.idle
    const second = stub.script()
    const later = SessionMessage.ID.create()
    yield* chat.chat("/prompt", {
      method: "POST",
      body: JSON.stringify({ id: later, text: second.marker, delivery: "steer" }),
    })
    yield* Effect.promise(() => second.called())
    yield* chat.idle
    const all = (yield* chat.read).messages
    const boundary = chat
      .chat("")
      .pipe(
        Effect.map(
          (body) =>
            Schema.decodeUnknownSync(
              Schema.Struct({ revert: Schema.optional(Schema.Struct({ messageID: Schema.String })) }),
            )(body).revert?.messageID,
        ),
      )
    yield* chat.chat("/revert", { method: "POST", body: JSON.stringify({ messageID: later }) })
    expect(yield* boundary).toBe(later)
    yield* chat.synced
    yield* Host.forgetHarness(chat.brainId)
    expect([yield* boundary, (yield* chat.read).messages]).toEqual([later, all])
    yield* chat.chat("/revert", { method: "DELETE" })
    expect(yield* boundary).toBeUndefined()
  }),
)

it.live(
  "Ren's saved history of a synced chat has the same pages as the brain's Chat API, and hides a staged revert",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const first = stub.script()
      const chat = yield* opened(`open ${first.marker}`)
      yield* Effect.promise(() => first.called())
      yield* chat.idle
      const second = stub.script({ tool: { name: "shell", input: { command: "echo two" } } })
      const later = SessionMessage.ID.create()
      yield* chat.chat("/prompt", {
        method: "POST",
        body: JSON.stringify({ id: later, text: second.marker, delivery: "steer" }),
      })
      yield* Effect.promise(() => second.called(2))
      yield* chat.idle
      yield* chat.synced
      const actor = { userId: chat.owner.createdBy, organizationId: chat.owner.organizationId, roles: ["owner"] }
      const Brain = Schema.Struct({
        items: Schema.Array(Schema.Json),
        cursor: Schema.Struct({ next: Schema.optional(Schema.String) }),
      })
      const brainPages = (cursor?: string): Effect.Effect<ReadonlyArray<ReadonlyArray<Schema.Json>>> =>
        chat.chat(`/message?limit=2${cursor ? `&cursor=${cursor}` : ""}`).pipe(
          Effect.map((body) => Schema.decodeUnknownSync(Brain)(body)),
          Effect.flatMap((page) => {
            if (page.items.length === 0) return Effect.succeed([])
            if (!page.cursor.next) return Effect.succeed([page.items])
            return brainPages(page.cursor.next).pipe(Effect.map((rest) => [page.items, ...rest]))
          }),
        )
      const renPages = (cursor?: string): Effect.Effect<ReadonlyArray<ReadonlyArray<Schema.Json>>, unknown> =>
        sessions.messages(actor, chat.sessionId, { limit: 2, ...(cursor && { cursor }) }).pipe(
          Effect.map((page) => Schema.encodeSync(SessionMessage.Page)(page)),
          Effect.flatMap((page) =>
            page.cursor.next
              ? renPages(page.cursor.next).pipe(Effect.map((rest) => [page.items, ...rest]))
              : Effect.succeed([page.items]),
          ),
        )
      const expected = yield* brainPages()
      expect(expected.flat().length).toBeGreaterThan(4)
      expect(yield* renPages()).toEqual(expected)
      yield* chat.chat("/revert", { method: "POST", body: JSON.stringify({ messageID: later }) })
      yield* chat.synced
      const kept = expected
        .flat()
        .map((item) => Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(item).id)
      expect((yield* renPages()).flat()).toEqual(expected.flat().slice(kept.indexOf(later) + 1))
    }),
)

it.live(
  "a chat restored into a missing folder on the brain's own hand gets the folder back, one note, and a files reset time in Ren; a kept folder gets no note",
  () =>
    Effect.gen(function* () {
      const script = stub.script()
      const chat = yield* opened(`open ${script.marker}`)
      yield* Effect.promise(() => script.called())
      yield* chat.idle
      const shell = stub.script({ tool: { name: "shell", input: { command: "echo kept > note.txt" } } })
      yield* chat.chat("/prompt", {
        method: "POST",
        body: JSON.stringify({ id: SessionMessage.ID.create(), text: shell.marker, delivery: "steer" }),
      })
      yield* Effect.promise(() => shell.called(2))
      yield* chat.idle
      const Note = Schema.Struct({
        type: Schema.String,
        metadata: Schema.optional(Schema.Struct({ source: Schema.optional(Schema.String) })),
        payload: Schema.optional(
          Schema.Struct({ metadata: Schema.optional(Schema.Struct({ source: Schema.optional(Schema.String) })) }),
        ),
      })
      const isNote = (item: typeof Note.Type) =>
        item.type === "synthetic" &&
        (item.metadata?.source === "ren.files-reset" || item.payload?.metadata?.source === "ren.files-reset")
      const notes = Effect.all([chat.chat("/message?limit=200"), chat.chat("/inbox")]).pipe(
        Effect.map(
          (found) =>
            [
              ...Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(Note) }))(found[0]).items,
              ...Schema.decodeUnknownSync(Schema.Array(Note))(found[1]),
            ].filter(isNote).length,
        ),
      )
      yield* chat.synced
      yield* Host.forgetHarness(chat.brainId)
      expect(yield* notes).toBe(0)
      yield* chat.synced
      yield* Host.forgetHarness(chat.brainId, { folderOf: chat.sessionId })
      expect(yield* notes).toBe(1)
      yield* chat.synced
      const sessions = yield* Session.Service
      const actor = { userId: chat.owner.createdBy, organizationId: chat.owner.organizationId, roles: ["owner"] }
      expect((yield* sessions.get(actor, chat.sessionId)).filesResetAt).not.toBeNull()
    }),
)

it.live(
  "a brain that boots on another harness version clears its harness database only when the old version flushed sync, and the chat comes back on its first request",
  () =>
    Effect.gen(function* () {
      const script = stub.script()
      const chat = yield* opened(`open ${script.marker}`)
      yield* Effect.promise(() => script.called())
      yield* chat.idle
      const before = yield* chat.read
      yield* chat.synced
      const provider = yield* SandboxProvider.Service
      const found = (yield* provider.list.pipe(Effect.orDie)).find((each) => each.brainId === chat.brainId)
      const home = Schema.decodeUnknownSync(Schema.Struct({ home: Schema.String }))(found?.binding).home
      const older = "0.0.1-older"
      yield* Host.restart(chat.brainId, async (folder) =>
        HarnessDb.setBrainKeys(folder, { "ren:harness-version": older }),
      )
      yield* chat.idle
      expect(HarnessDb.hasChat(home, chat.sessionId)).toBe(true)
      yield* Host.restart(chat.brainId, async (folder) =>
        HarnessDb.setBrainKeys(folder, { "ren:harness-version": older, "ren:flushed-version": older }),
      )
      yield* chat.idle
      expect(HarnessDb.hasChat(home, chat.sessionId)).toBe(false)
      expect(yield* chat.read).toEqual(before)
    }),
)

it.live("a chat that Ren deleted leaves its brain's harness at the next pull", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const script = stub.script()
    const chat = yield* opened(`open ${script.marker}`)
    yield* Effect.promise(() => script.called())
    yield* chat.idle
    yield* chat.synced
    yield* database.db.delete(Database.Schema.agent_session).where(eq(Database.Schema.agent_session.id, chat.sessionId))
    const host = yield* BrainHost.Service
    const client = yield* BrainClient.Service
    const api = yield* client.brain(yield* host.target(chat.brainId).pipe(Effect.orDie))
    yield* api.brain["brain.wake"]().pipe(Effect.orDie)
    const provider = yield* SandboxProvider.Service
    const found = (yield* provider.list.pipe(Effect.orDie)).find((each) => each.brainId === chat.brainId)
    const home = Schema.decodeUnknownSync(Schema.Struct({ home: Schema.String }))(found?.binding).home
    expect(HarnessDb.hasChat(home, chat.sessionId)).toBe(false)
  }),
)
