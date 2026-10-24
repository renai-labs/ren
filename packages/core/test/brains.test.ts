import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { Shared, TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { BrainToken } from "@ren/host-api/brain-token"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { Signature } from "@ren/schema/signature"
import { Clock, Duration, Effect, Layer, Option, Queue, Result, Schema } from "effect"
import { eq } from "drizzle-orm"
import { TestClock } from "effect/testing"
import { BrainRegistry } from "../src/brain-registry.js"
import { Brains } from "../src/brains.js"
import { Models } from "../src/models.js"
import { SessionRunner } from "../src/session/runner.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, Shared.stub().url)

const fixed = Layer.succeed(
  Models.Service,
  Models.Service.of({
    revision: Effect.succeed("test"),
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
  }),
)

const it = testEffect(Testing.layer)

const stub = Shared.stub()

const claims = (publicKeys: ReadonlyArray<Signature.PublicKey>, token: string) =>
  BrainToken.verify(publicKeys, token).pipe(
    Effect.flatMap((found) =>
      Option.isSome(found) ? Effect.succeed(found.value) : Effect.die(new Error("an invalid token")),
    ),
  )

const cell = { url: "", port: 0, dispose: () => Promise.resolve() }
beforeAll(async () => {
  Object.assign(cell, await Host.wrangler())
}, 180_000)
afterAll(() => cell.dispose())

const hosts = [
  {
    name: "the sandbox host",
    it: testEffect(
      SessionRunner.layer.pipe(
        Layer.provideMerge(BrainRegistry.layer),
        Layer.provideMerge(Host.layer({}, fixed)),
        Layer.provideMerge(Testing.layer),
      ),
    ),
    publicKeys: Host.keys.map((key) => key.publicKey),
    hasHand: true,
  },
  {
    name: "the cell host",
    it: testEffect(
      SessionRunner.layer.pipe(
        Layer.provideMerge(BrainRegistry.layer),
        Layer.provideMerge(Layer.unwrap(Effect.sync(() => Host.wranglerLayer(cell, fixed)))),
        Layer.provideMerge(Testing.layer),
      ),
    ),
    publicKeys: TestToken.publicKeys,
    hasHand: false,
  },
]

const created = Effect.fnUntraced(function* (initial?: string) {
  const sessions = yield* SessionRunner.Service
  const owner = yield* Seed.owner()
  const sessionId = Session.ID.create()
  yield* sessions.create(owner, {
    sessionId,
    harness: "opencode",
    interactive: true,
    ...(initial && {
      initialMessage: {
        messageId: Session.MessageID.create(),
        prompt: { text: initial },
        sender: { userId: owner.createdBy },
      },
    }),
  })
  return { owner, sessionId }
})

const brainOf = Effect.fnUntraced(function* (sessionId: Session.ID) {
  const database = yield* Database.Service
  const row = (yield* database.db
    .select({ brainId: Database.Schema.agent_session.brain_id })
    .from(Database.Schema.agent_session)
    .where(eq(Database.Schema.agent_session.id, sessionId))).at(0)
  if (!row) return yield* Effect.die(new Error(`Session ${sessionId} has no brain`))
  return row.brainId
})

const sendTo = (sessionId: Session.ID, text: string, messageId = Session.MessageID.create()) =>
  Brains.Service.use((brain) =>
    brain.send({ sessionId, messageId, prompt: { text }, delivery: "steer", sender: { userId: "user_1" } }),
  )

describe("Brains on the cell host", () => {
  it.effect(
    "a start while the cell answers 503 is delivered once the cell answers, not dropped",
    () =>
      Effect.gen(function* () {
        const gate = { open: false }
        const answers = yield* Queue.unbounded<number>()
        const cell = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async (request) => {
                const status = gate.open ? 200 : 503
                Queue.offerUnsafe(answers, status)
                if (!gate.open) return new Response("busy", { status })
                const body = Schema.decodeUnknownSync(Schema.Struct({ sessionId: Schema.String }))(await request.json())
                return Response.json({ sessionId: body.sessionId, harness: "opencode" })
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const sleeps = yield* Queue.unbounded<number>()
        const clock = yield* TestClock.testClockWith((testClock) =>
          Effect.succeed<Clock.Clock>({
            ...testClock,
            sleep: (duration) =>
              Queue.offer(sleeps, Duration.toMillis(duration)).pipe(Effect.andThen(testClock.sleep(duration))),
          }),
        )
        yield* Queue.take(sleeps).pipe(
          Effect.flatMap((millis) =>
            millis < Duration.toMillis("30 seconds") ? TestClock.adjust(millis) : Effect.void,
          ),
          Effect.forever,
          Effect.forkChild,
        )
        const owner = yield* Seed.owner()
        const sessionId = yield* Seed.session(owner)
        yield* Effect.gen(function* () {
          const brains = yield* Brains.Service
          yield* brains
            .start(
              { sessionId, harness: "opencode", interactive: true },
              { ...owner, brainId: Brain.ofSession(sessionId) },
            )
            .pipe(Effect.forkChild)
          const refused = yield* Effect.forEach(Array.from({ length: 5 }), () => Queue.take(answers))
          gate.open = true
          expect([...refused, yield* Queue.take(answers)]).toEqual([503, 503, 503, 503, 503, 200])
        }).pipe(
          Effect.provide(Host.cellLayer({ CELL_URL: cell.url.origin }, fixed, Host.noTemplates)),
          Effect.provideService(Clock.Clock, clock),
        )
      }),
    15_000,
  )
})

for (const host of hosts)
  describe(`Brains on ${host.name}`, () => {
    host.it.live("a start delivers its initial message, and the turn uses the granted key", () =>
      Effect.gen(function* () {
        const script = stub.script()
        yield* created(`initial ${script.marker}`)
        expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-configured")
      }),
    )

    host.it.live("a send answers its message id once the brain accepts it, and the turn reaches the model", () =>
      Effect.gen(function* () {
        const opened = stub.script()
        const chat = yield* created(`open ${opened.marker}`)
        yield* Effect.promise(() => opened.called())
        const script = stub.script()
        const messageId = Session.MessageID.create()
        expect(yield* sendTo(chat.sessionId, `hello ${script.marker}`, messageId)).toEqual({ messageId })
        expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
      }),
    )

    host.it.live("access is ready only once the chat has started on its brain, so its first read finds it", () =>
      Effect.gen(function* () {
        const brain = yield* Brains.Service
        const chat = yield* created(`open ${stub.script().marker}`)
        const access = yield* Host.ready(brain.access(chat.sessionId, { userId: chat.owner.createdBy }))
        const read = yield* Effect.promise(() =>
          fetch(`${access.url}/chat/session/${chat.sessionId}`, {
            headers: { authorization: TestToken.basic(access.token) },
          }),
        )
        expect(read.status).toBe(200)
      }),
    )

    host.it.live("an access token reads its chat through the Chat API and names its member", () =>
      Effect.gen(function* () {
        const brain = yield* Brains.Service
        const opened = stub.script()
        const chat = yield* created(`open ${opened.marker}`)
        yield* Effect.promise(() => opened.called())
        const say = Effect.fnUntraced(function* (member: { readonly userId: Auth.UserID; readonly name: string }) {
          const access = yield* Host.ready(brain.access(chat.sessionId, member))
          const script = stub.script()
          const response = yield* Effect.promise(() =>
            fetch(`${access.url}/chat/session/${chat.sessionId}/prompt`, {
              method: "POST",
              headers: { authorization: TestToken.basic(access.token), "content-type": "application/json" },
              body: JSON.stringify({ id: SessionMessage.ID.create(), text: script.marker, delivery: "steer" }),
            }),
          )
          expect(response.status).toBe(200)
          return (yield* Effect.promise(() => script.called())).text
        })
        const access = yield* Host.ready(brain.access(chat.sessionId, { userId: chat.owner.createdBy }))
        const read = yield* Effect.promise(() =>
          fetch(`${access.url}/chat/session/${chat.sessionId}`, {
            headers: { authorization: TestToken.basic(access.token) },
          }),
        )
        expect([read.status, yield* claims(host.publicKeys, access.token)]).toMatchObject([
          200,
          { scope: "client", sid: chat.sessionId },
        ])
        const grace = { userId: Auth.UserID.create(), name: "Grace Hopper" }
        expect(yield* say({ userId: chat.owner.createdBy, name: "Ada" })).not.toContain("<message_from")
        expect(yield* say(grace)).toContain(
          `<message_from user="Grace Hopper" user_id=${JSON.stringify(grace.userId)} />`,
        )
      }),
    )

    host.it.live(
      "a chat without a template gets the brain's own hand where the host has one, and no hand where it has none",
      () =>
        Effect.gen(function* () {
          const brains = yield* Brains.Service
          const chat = yield* created(`open ${stub.script().marker}`)
          yield* Host.ready(brains.access(chat.sessionId, { userId: chat.owner.createdBy }))
          const found = yield* brains
            .accessEnvironment(
              {
                brainId: yield* brainOf(chat.sessionId),
                organizationId: chat.owner.organizationId,
                spaceId: chat.owner.spaceId,
                generation: 1,
              },
              chat.sessionId,
            )
            .pipe(Effect.result)
          expect(
            Result.isSuccess(found)
              ? { hand: found.success.url.hostname, directory: found.success.directory.endsWith(`/${chat.sessionId}`) }
              : found.failure._tag,
          ).toEqual(host.hasHand ? { hand: "127.0.0.1", directory: true } : "EnvironmentNotFoundError")
        }),
    )
  })
