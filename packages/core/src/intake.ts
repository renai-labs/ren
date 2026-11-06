export * as Intake from "./intake.js"

import { Observability } from "@ren/schema/observability"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Option, Result, Schema, Struct } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainHost } from "./brain-host.js"
import { DurableRunner } from "./durable-runner.js"
import { IntakeThreads } from "./intake-threads.js"
import { SessionRunner } from "./session/runner.js"

export interface Request {
  readonly headers: Headers
  readonly body: string
}

export interface Reply {
  readonly status: number
  readonly body?: Schema.Json
}

export type Received<Event> =
  | ({ readonly _tag: "Answer" } & Reply)
  | { readonly _tag: "Start"; readonly status: number; readonly event: Event }

export interface Key {
  readonly scope: string
  readonly eventId: string
  readonly threadKey?: string
}

export interface Route {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly senderUserId: Auth.UserID
  readonly agentId?: Agent.ID
  readonly requiresAgent: boolean
  readonly targetSessionId?: Session.ID
  readonly takesThread: boolean
}

export interface Ids {
  readonly sessionId: Session.ID
  readonly messageId: Session.MessageID
}

export type Message = Omit<Session.SendInput, "sessionId" | "messageId" | "delivery" | "sender">

export type Failure = "rejected" | "brain_failed" | "agent_gone"

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

// oxlint-disable-next-line ren/no-comments -- Methods, not function properties: their parameters are bivariant, so Sources holds sources of every event type as Source<unknown>. Intake only passes a source's decoded event and route back to that same source.
export interface Source<Event, Resolved extends Route = Route, Skip = never> {
  readonly origin: Session.Origin
  readonly event: Schema.Codec<Event, Schema.Json>
  readonly delivery: Session.Delivery
  receive(request: Request): Effect.Effect<Received<Event>>
  keyOf(event: Event): Key
  resolve(event: Event): Effect.Effect<Resolved, Skip>
  promptOf(event: Event, route: Resolved, ids: Ids): Effect.Effect<Message>
  report(event: Event, outcome: Outcome<Resolved, Skip>): Effect.Effect<void>
}

type Any = Source<unknown, Route, unknown>

export class Sources extends Context.Service<
  Sources,
  { readonly get: (origin: Session.Origin) => Option.Option<Any> }
>()("@ren/core/Intake/Sources") {}

export const sources = <E, R>(build: Effect.Effect<ReadonlyArray<Any>, E, R>) =>
  Layer.effect(
    Sources,
    Effect.gen(function* () {
      const all = yield* build
      const origins = all.map((source) => source.origin)
      if (new Set(origins).size !== origins.length)
        return yield* Effect.die(new Error(`Two intake sources share an origin: ${origins.join(", ")}`))
      return Sources.of({ get: (origin) => Option.fromNullishOr(all.find((source) => source.origin === origin)) })
    }),
  )

export const Run = DurableRunner.make("IntakeRun", {
  payload: {
    origin: Session.Origin,
    scope: Schema.String,
    eventId: Schema.String,
    threadKey: Schema.optionalKey(Schema.String),
    event: Schema.Json,
    sessionId: Session.ID,
    messageId: Session.MessageID,
  },
  idempotencyKey: (payload) => `${payload.origin}:${payload.scope}:${payload.eventId}`,
})

export interface Interface {
  readonly receive: (origin: Session.Origin, request: Request) => Effect.Effect<Reply>
  readonly start: (origin: Session.Origin, event: Schema.Json) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Intake") {}

class Stopped extends Schema.TaggedError<Stopped>()("Intake.Stopped", {
  reason: Schema.Literals(["rejected", "brain_failed", "agent_gone"]),
  message: Schema.String,
  sessionId: Schema.optionalKey(Session.ID),
}) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sources = yield* Sources
    const threads = yield* IntakeThreads.Service
    const runner = yield* SessionRunner.Service
    const brainHost = yield* BrainHost.Service
    const engine = yield* WorkflowEngine.WorkflowEngine

    const store = (source: Any, event: unknown) =>
      Effect.gen(function* () {
        const key = source.keyOf(event)
        yield* DurableRunner.ensure(Run, {
          origin: source.origin,
          scope: key.scope,
          eventId: key.eventId,
          ...(key.threadKey && { threadKey: key.threadKey }),
          event: yield* Schema.encodeEffect(source.event)(event),
          sessionId: Session.ID.create(),
          messageId: Session.MessageID.create(),
        })
      }).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine))

    const send = (input: Session.SendInput) =>
      runner.send(input).pipe(
        Effect.catchTag("BrainRejectedError", (error) =>
          Effect.fail(new Stopped({ reason: "rejected", message: error.message, sessionId: input.sessionId })),
        ),
        Effect.catchTag("BrainUnavailable", (error) =>
          Effect.gen(function* () {
            const session = yield* runner.get(input.sessionId).pipe(Effect.orDie)
            const state = yield* brainHost.access(session.brainId)
            if (state._tag === "Failed")
              return yield* new Stopped({
                reason: "brain_failed",
                message: `The brain failed: ${state.reason}`,
                sessionId: input.sessionId,
              })
            return yield* error
          }),
        ),
      )

    const deliver = Effect.fnUntraced(function* (
      source: Any,
      payload: typeof Run.payloadSchema.Type,
      event: unknown,
      route: Route,
    ) {
      const chat =
        route.targetSessionId || route.takesThread || !payload.threadKey
          ? { sessionId: route.targetSessionId ?? payload.sessionId, exists: Boolean(route.targetSessionId) }
          : yield* threads.claim(payload.origin, payload.scope, payload.threadKey, payload.sessionId, route)
      if (route.takesThread && payload.threadKey)
        yield* threads.take(payload.origin, payload.scope, payload.threadKey, chat.sessionId, route)
      const message = {
        ...(yield* source.promptOf(event, route, { sessionId: chat.sessionId, messageId: payload.messageId })),
        messageId: payload.messageId,
        sender: { userId: route.senderUserId },
      }
      const continued = send({ ...message, sessionId: chat.sessionId, delivery: source.delivery }).pipe(
        Effect.as("continued" as const),
      )
      if (chat.exists) return { _tag: yield* continued, sessionId: chat.sessionId }
      const create = (options: { readonly agentId?: Agent.ID }) =>
        runner
          .create(
            {
              organizationId: route.organizationId,
              spaceId: route.spaceId,
              createdBy: route.senderUserId,
              origin: payload.origin,
            },
            { sessionId: chat.sessionId, harness: "opencode", interactive: false, initialMessage: message },
            options,
          )
          .pipe(Effect.as("started" as const))
      const agentId = route.agentId
      const tag = yield* (
        agentId
          ? create({ agentId }).pipe(
              Effect.catchTag("SessionRunner.NotFound", (error) =>
                Effect.gen(function* () {
                  if (route.requiresAgent) return yield* new Stopped({ reason: "agent_gone", message: error.message })
                  yield* Effect.logWarning(`Agent ${agentId} is gone; the chat runs ren`)
                  return yield* create({})
                }),
              ),
            )
          : create({})
      ).pipe(
        Effect.catchTags({
          "SessionRunner.AlreadyExists": () => continued,
          "SessionRunner.NotFound": Effect.die,
          BrainRejectedError: (error) =>
            Effect.fail(new Stopped({ reason: "rejected", message: error.message, sessionId: chat.sessionId })),
        }),
      )
      return { _tag: tag, sessionId: chat.sessionId }
    })

    const run = Effect.fnUntraced(function* (payload: typeof Run.payloadSchema.Type) {
      const found = sources.get(payload.origin)
      if (Option.isNone(found)) return yield* Effect.logError(`No intake source ${payload.origin} runs this event`)
      const source = found.value
      const event = yield* Schema.decodeEffect(source.event)(payload.event).pipe(Effect.orDie)
      const resolved = yield* Effect.result(source.resolve(event))
      if (Result.isFailure(resolved)) return yield* source.report(event, { _tag: "skipped", reason: resolved.failure })
      const route = resolved.success
      yield* deliver(source, payload, event, route).pipe(
        Effect.flatMap((outcome) => source.report(event, { ...outcome, route })),
        Effect.catchTag("Intake.Stopped", (error) =>
          Effect.logWarning(`A ${payload.origin} run stopped: ${error.message}`).pipe(
            Effect.andThen(
              source.report(event, {
                _tag: "failed",
                route,
                reason: error.reason,
                message: error.message,
                ...(error.sessionId && { sessionId: error.sessionId }),
              }),
            ),
          ),
        ),
      )
    })

    yield* DurableRunner.register(Run, (payload) =>
      DurableRunner.supervise(
        `intake:${payload.origin}:${payload.scope}:${payload.eventId}`,
        run(payload).pipe(Observability.Trace.intakeRun, Effect.annotateSpans("ren.session.id", payload.sessionId)),
      ),
    )

    return Service.of({
      receive: Effect.fn("Intake.receive")(function* (origin: Session.Origin, request: Request) {
        const found = sources.get(origin)
        if (Option.isNone(found)) return { status: 404 } satisfies Reply
        const received = yield* found.value.receive(request)
        if (received._tag === "Answer") return Struct.omit(received, ["_tag"])
        return yield* store(found.value, received.event).pipe(
          Effect.as({ status: received.status } satisfies Reply),
          Effect.catchCause((cause) =>
            Effect.logError(`A ${origin} event could not be stored`, cause).pipe(
              Effect.as({ status: 500 } satisfies Reply),
            ),
          ),
        )
      }),
      start: Effect.fn("Intake.start")(function* (origin: Session.Origin, event: Schema.Json) {
        const found = sources.get(origin)
        if (Option.isNone(found)) return yield* Effect.logError(`No intake source ${origin} starts this event`)
        const decoded = yield* Schema.decodeEffect(found.value.event)(event).pipe(Effect.orDie)
        yield* store(found.value, decoded).pipe(Effect.orDie)
      }),
    })
  }),
)
