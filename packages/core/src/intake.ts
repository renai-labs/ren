export * as Intake from "./intake.js"

import { Observability } from "@ren/schema/observability"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Cause, Context, Effect, Layer, Match, Option, Result, Schema, Struct } from "effect"
import { PersistedQueue } from "effect/persistence"
import { BrainHost } from "./brain-host.js"
import { IntakeThreads } from "./intake-threads.js"
import { SessionRunner } from "./session/runner.js"

export interface Request {
  readonly method: string
  readonly params: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
  readonly headers: Headers
  readonly body: string
  readonly bodyTooLarge?: boolean
}

export interface Reply {
  readonly status: number
  readonly body?: Schema.Json
  readonly contentType?: string
}

export type Received<Event> =
  | ({ readonly _tag: "Answer" } & Reply)
  | {
      readonly _tag: "Start"
      readonly status: number
      readonly event: Event
      readonly undo?: Effect.Effect<void>
    }

export interface Key {
  readonly originId: string
  readonly eventId: string
  readonly threadKey?: string
}

export type Chat = { readonly _tag: "Thread" } | { readonly _tag: "Assigned"; readonly sessionId?: Session.ID }

export interface Route {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly senderUserId: Auth.UserID
  readonly agentId?: Agent.ID
  readonly title?: string
  readonly chat: Chat
}

export interface Ids {
  readonly sessionId: Session.ID
  readonly messageId: Session.MessageID
}

export type Message = Omit<Session.SendInput, "sessionId" | "messageId" | "delivery" | "sender">

export const Failure = Schema.Literals(["rejected", "brain_failed", "agent_gone", "unavailable"]).annotate({
  identifier: "Intake.Failure",
})
export type Failure = typeof Failure.Type

export type Outcome<Resolved, Skip> =
  | { readonly _tag: "started" | "continued"; readonly route: Resolved; readonly sessionId: Session.ID }
  | { readonly _tag: "skipped"; readonly reason: Skip }
  | {
      readonly _tag: "failed"
      readonly route: Resolved
      readonly reason: Failure
      readonly message: string
      readonly sessionId?: Session.ID
    }

export class Unavailable extends Schema.TaggedError<Unavailable>()("Intake.Unavailable", {
  message: Schema.String,
}) {}

export interface Receiver<Event> {
  readonly origin: Session.Origin
  readonly event: Schema.Codec<Event, Schema.Json>
  receive(request: Request): Effect.Effect<Received<Event>>
  keyOf(event: Event): Key
}

export interface Worker<Event, Resolved extends Route = Route, Skip = never> {
  readonly origin: Session.Origin
  readonly event: Schema.Codec<Event, Schema.Json>
  readonly delivery: Session.Delivery
  resolve(event: Event): Effect.Effect<Resolved, Skip>
  promptOf(event: Event, route: Resolved, ids: Ids): Effect.Effect<Message, Unavailable>
  report(event: Event, outcome: Outcome<Resolved, Skip>): Effect.Effect<void>
}

type AnyReceiver = Receiver<unknown>

type AnyWorker = Worker<unknown, Route, unknown>

const byOrigin = <A extends { readonly origin: Session.Origin }>(kind: string, all: ReadonlyArray<A>) => {
  const origins = all.map((each) => each.origin)
  if (new Set(origins).size !== origins.length)
    return Effect.die(new Error(`Two intake ${kind} share an origin: ${origins.join(", ")}`))
  return Effect.succeed({
    get: (origin: Session.Origin) => Option.fromNullishOr(all.find((each) => each.origin === origin)),
  })
}

export class Receivers extends Context.Service<
  Receivers,
  { readonly get: (origin: Session.Origin) => Option.Option<AnyReceiver> }
>()("@ren/core/Intake/Receivers") {}

export class Workers extends Context.Service<
  Workers,
  { readonly get: (origin: Session.Origin) => Option.Option<AnyWorker> }
>()("@ren/core/Intake/Workers") {}

export const receivers = <E, R>(build: Effect.Effect<ReadonlyArray<AnyReceiver>, E, R>) =>
  Layer.effect(
    Receivers,
    Effect.flatMap(build, (all) => byOrigin("receivers", all)),
  )

export const workers = <E, R>(build: Effect.Effect<ReadonlyArray<AnyWorker>, E, R>) =>
  Layer.effect(
    Workers,
    Effect.flatMap(build, (all) => byOrigin("workers", all)),
  )

export interface Item extends Schema.Schema.Type<typeof Item> {}
export const Item = Schema.Struct({
  origin: Session.Origin,
  originId: Schema.String,
  eventId: Schema.String,
  threadKey: Schema.optionalKey(Schema.String),
  event: Schema.Json,
  sessionId: Session.ID,
  messageId: Session.MessageID,
}).annotate({ identifier: "Intake.Item" })

export const attempts = 10

export const queue = PersistedQueue.make({ name: "intake", schema: Item, maxAttempts: attempts })

export const queueIdOf = (item: Pick<Item, "origin" | "originId" | "eventId">) =>
  `${item.origin}:${item.originId}:${item.eventId}`

export interface Interface {
  readonly receive: (origin: Session.Origin, request: Request) => Effect.Effect<Reply>
  readonly start: (origin: Session.Origin, event: Schema.Json) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Intake") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const receivers = yield* Receivers
    const items = yield* queue

    const offer = Effect.fnUntraced(function* (receiver: AnyReceiver, event: unknown) {
      const key = receiver.keyOf(event)
      const item = {
        origin: receiver.origin,
        originId: key.originId,
        eventId: key.eventId,
        ...(key.threadKey && { threadKey: key.threadKey }),
        event: yield* Schema.encodeEffect(receiver.event)(event),
        sessionId: Session.ID.create(),
        messageId: Session.MessageID.create(),
      }
      yield* items.offer(item, { id: queueIdOf(item) })
    })

    return Service.of({
      receive: Effect.fn("Intake.receive")(function* (origin: Session.Origin, request: Request) {
        const found = receivers.get(origin)
        if (Option.isNone(found)) return { status: 404 } satisfies Reply
        const received = yield* found.value.receive(request)
        if (received._tag === "Answer") return Struct.omit(received, ["_tag"])
        return yield* offer(found.value, received.event).pipe(
          Effect.as({ status: received.status } satisfies Reply),
          Effect.catchCause((cause) =>
            Effect.logError(`A ${origin} event could not be queued`, cause).pipe(
              Effect.andThen(received.undo ?? Effect.void),
              Effect.as({ status: 500 } satisfies Reply),
            ),
          ),
        )
      }),
      start: Effect.fn("Intake.start")(function* (origin: Session.Origin, event: Schema.Json) {
        const found = receivers.get(origin)
        if (Option.isNone(found)) return yield* Effect.die(new Error(`No intake receiver for ${origin}`))
        const decoded = yield* Schema.decodeEffect(found.value.event)(event).pipe(Effect.orDie)
        yield* offer(found.value, decoded).pipe(Effect.orDie)
      }),
    })
  }),
)

class Stopped extends Schema.TaggedError<Stopped>()("Intake.Stopped", {
  reason: Failure,
  message: Schema.String,
  sessionId: Schema.optionalKey(Session.ID),
}) {}

const deliver = Effect.fnUntraced(function* (worker: AnyWorker, item: Item, event: unknown, route: Route) {
  const threads = yield* IntakeThreads.Service
  const runner = yield* SessionRunner.Service
  const brainHost = yield* BrainHost.Service
  const threadKey = item.threadKey
  const chat = yield* Match.valueTags(route.chat, {
    Thread: () =>
      threadKey
        ? threads.claim(item.origin, item.originId, threadKey, item.sessionId, route)
        : Effect.succeed({ sessionId: item.sessionId, exists: false }),
    Assigned: (assigned) => {
      const sessionId = assigned.sessionId ?? item.sessionId
      return (threadKey ? threads.take(item.origin, item.originId, threadKey, sessionId, route) : Effect.void).pipe(
        Effect.as({ sessionId, exists: Boolean(assigned.sessionId) }),
      )
    },
  })
  const sessionId = chat.sessionId
  const message = {
    ...(yield* worker.promptOf(event, route, { sessionId, messageId: item.messageId })),
    messageId: item.messageId,
    sender: { userId: route.senderUserId },
  }
  const send = runner.send({ ...message, sessionId, delivery: worker.delivery }).pipe(
    Effect.catchTags({
      "SessionRunner.NotFound": (error) => Effect.fail(new Stopped({ reason: "agent_gone", message: error.message })),
      BrainRejectedError: (error) =>
        Effect.fail(new Stopped({ reason: "rejected", message: error.message, sessionId })),
      BrainUnavailable: (error) =>
        Effect.gen(function* () {
          const session = yield* runner.get(sessionId).pipe(Effect.orDie)
          const state = yield* brainHost.access(session.brainId)
          if (state._tag === "Failed")
            return yield* new Stopped({
              reason: "brain_failed",
              message: `The brain failed: ${state.reason}`,
              sessionId,
            })
          return yield* error
        }),
    }),
  )
  const label = runner
    .startedWith(sessionId, item.messageId)
    .pipe(Effect.map((started) => (started ? ("started" as const) : ("continued" as const))))
  if (chat.exists) {
    yield* send
    return { _tag: yield* label, sessionId }
  }
  const tag = yield* runner
    .create(
      {
        organizationId: route.organizationId,
        spaceId: route.spaceId,
        createdBy: route.senderUserId,
        origin: item.origin,
      },
      {
        sessionId,
        harness: "opencode",
        ...(route.title && { title: route.title }),
        interactive: false,
        initialMessage: message,
      },
      route.agentId ? { agentId: route.agentId } : {},
    )
    .pipe(
      Effect.as("started" as const),
      Effect.catchTags({
        "SessionRunner.AlreadyExists": () => send.pipe(Effect.andThen(label)),
        "SessionRunner.NotFound": (error) => Effect.fail(new Stopped({ reason: "agent_gone", message: error.message })),
        BrainRejectedError: (error) =>
          Effect.fail(new Stopped({ reason: "rejected", message: error.message, sessionId })),
      }),
    )
  return { _tag: tag, sessionId }
})

export const run = Effect.fnUntraced(function* (item: Item, meta: { readonly attempts: number }) {
  const workers = yield* Workers
  const found = workers.get(item.origin)
  if (Option.isNone(found)) return yield* Effect.logError(`No intake worker for ${item.origin}`)
  const worker = found.value
  const decoded = yield* Effect.result(Schema.decodeEffect(worker.event)(item.event))
  if (Result.isFailure(decoded))
    return yield* Effect.logError(`A ${item.origin} event does not decode; its job ends`, decoded.failure)
  const event = decoded.success
  const resolved = yield* Effect.result(worker.resolve(event))
  if (Result.isFailure(resolved)) return yield* worker.report(event, { _tag: "skipped", reason: resolved.failure })
  const route = resolved.success
  yield* deliver(worker, item, event, route).pipe(
    Effect.flatMap((outcome) => worker.report(event, { ...outcome, route })),
    Effect.catchTag("Intake.Stopped", (error) =>
      Effect.logWarning(`A ${item.origin} run stopped: ${error.message}`).pipe(
        Effect.andThen(
          worker.report(event, {
            _tag: "failed",
            route,
            reason: error.reason,
            message: error.message,
            ...(error.sessionId && { sessionId: error.sessionId }),
          }),
        ),
      ),
    ),
    Effect.onError((cause) =>
      meta.attempts < attempts || Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : worker.report(event, {
            _tag: "failed",
            route,
            reason: "unavailable",
            message: `The chat did not take the event in ${attempts} attempts`,
          }),
    ),
  )
}, Observability.Trace.intakeRun)

const concurrency = 16

export const layerWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const items = yield* queue
    const context = yield* Effect.context<Workers | IntakeThreads.Service | SessionRunner.Service | BrainHost.Service>()
    const take = items.take((item, meta) =>
      run(item, meta).pipe(
        Effect.annotateLogs({ intake: queueIdOf(item), attempt: meta.attempts }),
        Effect.annotateSpans({ "ren.session.id": item.sessionId, "ren.intake.origin": item.origin }),
        Effect.provideContext(context),
      ),
    )
    yield* Effect.forkScoped(
      Effect.forEach(
        Array.from({ length: concurrency }),
        () =>
          take.pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logWarning("An intake job failed", cause),
            ),
            Effect.forever,
          ),
        { concurrency: "unbounded", discard: true },
      ),
    )
  }),
)
