import { describe, expect, setDefaultTimeout } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Context, Effect, Exit, Layer, Schema } from "effect"
import { Intake } from "../src/intake.js"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const Event = Schema.Struct({
  id: Schema.String,
  thread: Schema.String,
  text: Schema.String,
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID,
  userId: Auth.UserID,
})

class Seen extends Context.Service<
  Seen,
  {
    readonly outcomes: Array<{
      readonly _tag: string
      readonly sessionId?: Session.ID | undefined
      readonly reason?: string
    }>
    readonly unavailable: { left: number }
  }
>()("@ren/core/test/Intake/Seen") {}

const origins = Layer.mergeAll(
  Intake.receivers(
    Effect.succeed([
      {
        origin: "webhook",
        event: Event,
        receive: (request) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(Event))(request.body).pipe(
            Effect.map((event): Intake.Received<typeof Event.Type> => ({ _tag: "Start", status: 202, event })),
            Effect.orElseSucceed((): Intake.Received<typeof Event.Type> => ({ _tag: "Answer", status: 400 })),
          ),
        keyOf: (event) => ({ originId: event.organizationId, eventId: event.id, threadKey: event.thread }),
      } satisfies Intake.Receiver<typeof Event.Type>,
    ]),
  ),
  Intake.workers(
    Effect.gen(function* () {
      const seen = yield* Seen
      return [
        {
          origin: "webhook",
          event: Event,
          delivery: "queue",
          resolve: (event) =>
            Effect.succeed({
              organizationId: event.organizationId,
              spaceId: event.spaceId,
              senderUserId: event.userId,
              chat: { _tag: "Thread" },
            }),
          promptOf: (event) =>
            Effect.suspend(() => {
              if (seen.unavailable.left === 0) return Effect.succeed({ prompt: { text: event.text } })
              seen.unavailable.left -= 1
              return Effect.fail(new Intake.Unavailable({ message: "The drive is down" }))
            }),
          report: (_event, outcome) =>
            Effect.sync(() => {
              seen.outcomes.push({
                _tag: outcome._tag,
                ...("sessionId" in outcome && outcome.sessionId && { sessionId: outcome.sessionId }),
                ...(outcome._tag === "failed" && { reason: outcome.reason }),
              })
            }),
        } satisfies Intake.Worker<typeof Event.Type>,
      ]
    }),
  ),
)

const it = testEffect(
  ChannelFixture.intakeLayer(origins).pipe(
    Layer.provideMerge(Layer.sync(Seen, () => ({ outcomes: [], unavailable: { left: 0 } }))),
  ),
)

const eventOf = (owner: Effect.Success<ReturnType<typeof Seed.owner>>, text: string, thread = "jane@acme.com") => ({
  id: crypto.randomUUID(),
  thread,
  text,
  organizationId: owner.organizationId,
  spaceId: owner.spaceId,
  userId: owner.createdBy,
})

const itemOf = (event: typeof Event.Type): Intake.Item => ({
  origin: "webhook",
  originId: event.organizationId,
  eventId: event.id,
  threadKey: event.thread,
  event: Schema.encodeSync(Event)(event),
  sessionId: Session.ID.create(),
  messageId: Session.MessageID.create(),
})

const request = (event: typeof Event.Type): Intake.Request => ({
  method: "POST",
  params: {},
  query: {},
  headers: new Headers(),
  body: JSON.stringify(event),
})

describe("Intake", () => {
  it.live("an event goes through the queue, and a second event of its thread continues the chat", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const intake = yield* Intake.Service
      const seen = yield* Seen
      const first = eventOf(owner, "Jane signed up")
      const second = eventOf(owner, "Jane upgraded")
      expect(yield* intake.receive("webhook", request(first))).toEqual({ status: 202 })
      yield* ChannelFixture.done(Intake.queueIdOf(itemOf(first)))
      expect(yield* intake.receive("webhook", request(second))).toEqual({ status: 202 })
      yield* ChannelFixture.done(Intake.queueIdOf(itemOf(second)))
      const accepted = yield* ChannelFixture.accepted(2)
      expect(accepted).toMatchObject([
        { kind: "start", prompt: { text: "Jane signed up" } },
        { kind: "send", sessionId: accepted[0]?.sessionId, delivery: "queue", prompt: { text: "Jane upgraded" } },
      ])
      expect(seen.outcomes).toEqual([
        { _tag: "started", sessionId: accepted[0]?.sessionId },
        { _tag: "continued", sessionId: accepted[0]?.sessionId },
      ])
    }),
  )

  it.live("a job that runs twice makes one chat and one message, and reports started both times", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const seen = yield* Seen
      const item = itemOf(eventOf(owner, "Jane signed up"))
      yield* Intake.run(item, { attempts: 1 })
      yield* Intake.run(item, { attempts: 2 })
      expect(yield* ChannelFixture.accepted(1)).toMatchObject([
        { kind: "start", sessionId: item.sessionId, messageId: item.messageId },
      ])
      expect((yield* ChannelFixture.Cell).accepted).toHaveLength(1)
      expect(seen.outcomes).toEqual([
        { _tag: "started", sessionId: item.sessionId },
        { _tag: "started", sessionId: item.sessionId },
      ])
    }),
  )

  it.live("two first events of one thread at once go into one chat, and the brain gets both", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const seen = yield* Seen
      const first = itemOf(eventOf(owner, "Jane signed up"))
      const second = itemOf(eventOf(owner, "Jane upgraded"))
      yield* Effect.all([Intake.run(first, { attempts: 1 }), Intake.run(second, { attempts: 1 })], {
        concurrency: "unbounded",
      })
      const accepted = yield* ChannelFixture.accepted(2)
      expect(new Set(accepted.map((message) => message.sessionId)).size).toBe(1)
      expect(accepted.map((message) => message.prompt.text).toSorted()).toEqual(["Jane signed up", "Jane upgraded"])
      expect(seen.outcomes.map((outcome) => outcome._tag).toSorted()).toEqual(["continued", "started"])
    }),
  )

  it.live("an attempt that fails runs again from the queue, into the same chat with the same message", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const intake = yield* Intake.Service
      const seen = yield* Seen
      const event = eventOf(owner, "Jane signed up")
      seen.unavailable.left = 1
      yield* intake.receive("webhook", request(event))
      yield* ChannelFixture.done(Intake.queueIdOf(itemOf(event)))
      const accepted = yield* ChannelFixture.accepted(1)
      expect(seen.unavailable.left).toBe(0)
      expect(seen.outcomes).toEqual([{ _tag: "started", sessionId: accepted[0]?.sessionId }])
    }),
  )

  it.live("only the last attempt that fails reports failed with unavailable, and every one fails the job", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const seen = yield* Seen
      const item = itemOf(eventOf(owner, "Jane signed up"))
      seen.unavailable.left = 2
      const early = yield* Effect.exit(Intake.run(item, { attempts: Intake.attempts - 1 }))
      const last = yield* Effect.exit(Intake.run(item, { attempts: Intake.attempts }))
      expect([Exit.isFailure(early), Exit.isFailure(last)]).toEqual([true, true])
      expect(seen.outcomes).toEqual([{ _tag: "failed", reason: "unavailable" }])
    }),
  )
})
