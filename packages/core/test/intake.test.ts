import { describe, expect, setDefaultTimeout } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { Intake } from "../src/intake.js"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const Event = Schema.Struct({
  id: Schema.String,
  thread: Schema.String,
  at: Schema.DateFromString,
  text: Schema.String,
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID,
  userId: Auth.UserID,
})

class Seen extends Context.Service<
  Seen,
  {
    readonly resolved: Array<unknown>
    readonly outcomes: Array<{ readonly _tag: string; readonly sessionId: Session.ID | undefined }>
  }
>()("@ren/core/test/Intake/Seen") {}

const source = Effect.gen(function* () {
  const seen = yield* Seen
  return {
    origin: "webhook",
    event: Event,
    delivery: "queue",
    receive: (request) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(Event))(request.body).pipe(
        Effect.map((event): Intake.Received<typeof Event.Type> => ({ _tag: "Start", status: 202, event })),
        Effect.orElseSucceed((): Intake.Received<typeof Event.Type> => ({ _tag: "Answer", status: 400 })),
      ),
    keyOf: (event) => ({ scope: event.organizationId, eventId: event.id, threadKey: event.thread }),
    resolve: (event) =>
      Effect.sync(() => {
        seen.resolved.push(event.at)
        return {
          organizationId: event.organizationId,
          spaceId: event.spaceId,
          senderUserId: event.userId,
          requiresAgent: false,
          takesThread: false,
        }
      }),
    promptOf: (event) => Effect.succeed({ prompt: { text: event.text } }),
    report: (_event, outcome) =>
      Effect.sync(() => {
        seen.outcomes.push({ _tag: outcome._tag, sessionId: "sessionId" in outcome ? outcome.sessionId : undefined })
      }),
  } satisfies Intake.Source<typeof Event.Type>
})

const it = testEffect(
  ChannelFixture.intakeLayer(Intake.sources(Effect.all([source]))).pipe(
    Layer.provideMerge(Layer.sync(Seen, () => ({ resolved: [], outcomes: [] }))),
  ),
)

const settled = (event: typeof Event.Type) =>
  Effect.gen(function* () {
    const executionId = yield* Intake.Run.executionId({
      origin: "webhook",
      scope: event.organizationId,
      eventId: event.id,
      event: Schema.encodeSync(Event)(event),
      messageId: Session.MessageID.create(),
      sessionId: Session.ID.create(),
    })
    yield* Intake.Run.poll(executionId).pipe(
      Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced("20 millis") }),
      Effect.timeoutOrElse({
        duration: "20 seconds",
        orElse: () => Effect.die(new Error(`The run of ${event.id} did not finish`)),
      }),
    )
  })

describe("Intake", () => {
  it.live(
    "a source's event reaches its run as its own schema decodes it, and a second event of its thread continues the chat with the source's delivery",
    () =>
      Effect.gen(function* () {
        const owner = yield* Seed.owner()
        const intake = yield* Intake.Service
        const seen = yield* Seen
        const event = (text: string) => ({
          id: crypto.randomUUID(),
          thread: "jane@acme.com",
          at: new Date("2026-11-06T10:42:00Z"),
          text,
          organizationId: owner.organizationId,
          spaceId: owner.spaceId,
          userId: owner.createdBy,
        })
        const first = event("Jane signed up")
        const second = event("Jane upgraded")
        const request = (body: typeof Event.Type) => ({
          headers: new Headers(),
          body: JSON.stringify(Schema.encodeSync(Event)(body)),
        })
        expect(yield* intake.receive("webhook", request(first))).toEqual({ status: 202 })
        yield* settled(first)
        expect(yield* intake.receive("webhook", request(second))).toEqual({ status: 202 })
        yield* settled(second)
        const accepted = yield* ChannelFixture.accepted(2)
        expect(accepted).toMatchObject([
          { kind: "start", prompt: { text: "Jane signed up" } },
          { kind: "send", sessionId: accepted[0]?.sessionId, delivery: "queue", prompt: { text: "Jane upgraded" } },
        ])
        expect(seen.resolved).toEqual([first.at, second.at])
        expect(seen.outcomes).toEqual([
          { _tag: "started", sessionId: accepted[0]?.sessionId },
          { _tag: "continued", sessionId: accepted[0]?.sessionId },
        ])
      }),
  )
})
