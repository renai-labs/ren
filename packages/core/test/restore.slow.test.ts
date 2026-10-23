import { expect, setDefaultTimeout } from "bun:test"
import { Shared, type StubModel, TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schedule, Schema } from "effect"
import { BrainRegistry } from "../src/brain-registry.js"
import { Brains } from "../src/brains.js"
import { Models } from "../src/models.js"
import { SessionRunner } from "../src/session/runner.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(120_000)

const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, stub.url)

const fixed = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
  }),
)

const it = testEffect(
  SessionRunner.layer.pipe(
    Layer.provideMerge(BrainRegistry.layer),
    Layer.provideMerge(Host.layerSynced({}, fixed)),
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
  yield* sessions.create(owner, {
    sessionId,
    harness: "opencode",
    interactive: true,
    initialMessage: { messageId: Session.MessageID.create(), prompt: { text }, sender: { userId: owner.createdBy } },
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
          ? Effect.promise(() => response.json())
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
  return { sessionId, brainId, owner, chat, idle, synced, read }
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
