export * as Link from "./link.js"

import { ChatAccess } from "@ren/chat/chat-access"
import type { Connection } from "@ren/chat/connection"
import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import {
  Clock,
  Context,
  Effect,
  Layer,
  PubSub,
  RcMap,
  Schema,
  type Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { RenApi } from "./ren.js"

export interface Link {
  readonly sessionId: Session.ID
  readonly client: Effect.Effect<ChatAccess.Client, ChatAccess.AccessFailed>
  readonly boot: SubscriptionRef.SubscriptionRef<ChatAccess.Boot>
  readonly status: SubscriptionRef.SubscriptionRef<Connection.Status>
  readonly retryAt: SubscriptionRef.SubscriptionRef<number>
  readonly busy: SubscriptionRef.SubscriptionRef<boolean>
  readonly frames: Effect.Effect<Stream.Stream<SessionEvent.Frame>, never, Scope.Scope>
  readonly wake: Effect.Effect<void>
  readonly lost: Effect.Effect<void>
}

const make = Effect.fn("Link.make")(function* (sessionId: Session.ID) {
  const ren = yield* RenApi.Service
  const frames = yield* Effect.acquireRelease(PubSub.unbounded<SessionEvent.Frame>(), PubSub.shutdown)
  const publishing = yield* Semaphore.make(1)
  const live = { current: false }
  const access = yield* ChatAccess.make({
    access: (input) =>
      Effect.flatMap(ren.client, (client) =>
        client.chat.access({ id: sessionId, ...(input.unreachable && { unreachable: "true" as const }) }),
      ),
  })
  const connection = yield* ChatAccess.connect(access, {
    flushInterval: 0,
    onFrames: (batch) =>
      publishing.withPermit(
        Effect.suspend(() => {
          live.current ||= batch.some((frame) => frame.type === "server.connected")
          return PubSub.publishAll(frames, batch)
        }),
      ),
    onStatus: (status) =>
      status === "connected"
        ? Effect.void
        : publishing.withPermit(
            Effect.sync(() => {
              live.current = false
            }),
          ),
  })
  const subscribe = publishing.withPermit(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(frames)
      const connected: SessionEvent.Frame = {
        id: "evt_link_connected",
        created: yield* Clock.currentTimeMillis,
        type: "server.connected",
        data: {},
      }
      return Stream.fromSubscription(subscription).pipe(Stream.prepend(live.current ? [connected] : []))
    }),
  )
  const busy = yield* SubscriptionRef.make(false)
  yield* (yield* subscribe).pipe(
    Stream.runForEach((frame) => {
      if (frame.type === "server.connected") return SubscriptionRef.set(busy, false)
      if (!("sessionID" in frame.data) || frame.data.sessionID !== sessionId) return Effect.void
      if (frame.type === "session.execution.started") return SubscriptionRef.set(busy, true)
      return frame.type === "session.execution.succeeded" ||
        frame.type === "session.execution.failed" ||
        frame.type === "session.execution.interrupted"
        ? SubscriptionRef.set(busy, false)
        : Effect.void
    }),
    Effect.forkScoped,
  )
  return {
    sessionId,
    client: access.client,
    boot: access.boot,
    status: connection.status,
    retryAt: connection.retryAt,
    busy,
    frames: subscribe,
    wake: Effect.andThen(connection.wake, connection.retryNow),
    lost: access.lost,
  } satisfies Link
})

class NotConnected extends Schema.TaggedError<NotConnected>()("Link.NotConnected", {
  message: Schema.String,
}) {}

export const connected = (link: Link) =>
  Effect.raceFirst(
    SubscriptionRef.changes(link.status).pipe(
      Stream.filter((status) => status === "connected"),
      Stream.runHead,
      Effect.asVoid,
    ),
    SubscriptionRef.changes(link.boot).pipe(
      Stream.switchMap((boot) => {
        if (boot._tag === "Starting") return Stream.never
        if (boot._tag === "Failed")
          return Stream.fail(
            new NotConnected({ message: `Ren could not start this session’s brain: ${boot.reason}. Run /ren:retry.` }),
          )
        if (boot._tag === "Stopped")
          return Stream.fail(
            new NotConnected({ message: "The space of this session was shut down. Run /ren:retry to start it again." }),
          )
        return Stream.fromEffect(Effect.sleep("1 minute")).pipe(
          Stream.flatMap(() =>
            Stream.fail(new NotConnected({ message: "Ren’s brain did not answer within a minute." })),
          ),
        )
      }),
      Stream.runDrain,
    ),
  )

export class Service extends Context.Service<
  Service,
  {
    readonly open: (sessionId: Session.ID) => Effect.Effect<Link, never, Scope.Scope>
    readonly opened: SubscriptionRef.SubscriptionRef<ReadonlyMap<Session.ID, Link>>
    readonly reset: (sessionId: Session.ID) => Effect.Effect<void>
  }
>()("@ren/opencode/Link") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const opened = yield* SubscriptionRef.make<ReadonlyMap<Session.ID, Link>>(new Map())
    const links = yield* RcMap.make({
      lookup: (sessionId: Session.ID) =>
        Effect.tap(make(sessionId), (link) =>
          Effect.acquireRelease(
            SubscriptionRef.update(opened, (current) => new Map(current).set(sessionId, link)),
            () =>
              SubscriptionRef.update(opened, (current) => {
                if (current.get(sessionId) !== link) return current
                const next = new Map(current)
                next.delete(sessionId)
                return next
              }),
          ),
        ),
    })
    return Service.of({
      open: (sessionId) => RcMap.get(links, sessionId),
      opened,
      reset: (sessionId) => RcMap.invalidate(links, sessionId),
    })
  }),
)
