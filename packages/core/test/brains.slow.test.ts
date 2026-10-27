import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { TestToken } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { BrainToken } from "@ren/host-api/brain-token"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { Signature } from "@ren/schema/signature"
import { Effect, Layer, Option, Result } from "effect"
import { eq } from "drizzle-orm"
import { BrainRegistry } from "../src/brain-registry.js"
import { Brains } from "../src/brains.js"
import { SessionRunner } from "../src/session/runner.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const stub = Configured.stub

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
    it: testEffect(Configured.runnerLayer),
    publicKeys: Host.keys.map((key) => key.publicKey),
    hasHand: true,
  },
  {
    name: "the cell host",
    it: testEffect(
      SessionRunner.layer.pipe(
        Layer.provideMerge(BrainRegistry.layer),
        Layer.provideMerge(Layer.unwrap(Effect.sync(() => Host.wranglerLayer(cell, Configured.models)))),
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
        const access = yield* Host.ready(
          brain.access(chat.sessionId, { userId: chat.owner.createdBy, memberId: Auth.MemberID.create() }),
        )
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
          const access = yield* Host.ready(
            brain.access(chat.sessionId, { ...member, memberId: Auth.MemberID.create() }),
          )
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
        const access = yield* Host.ready(
          brain.access(chat.sessionId, { userId: chat.owner.createdBy, memberId: Auth.MemberID.create() }),
        )
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
          yield* Host.ready(
            brains.access(chat.sessionId, { userId: chat.owner.createdBy, memberId: Auth.MemberID.create() }),
          )
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
