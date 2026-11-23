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
  type Scope,
  Semaphore,
  Stream,
  type SubscriptionRef,
} from "effect"
import { RenApi } from "./ren.js"

export interface Link {
  readonly sessionId: Session.ID
  readonly client: Effect.Effect<ChatAccess.Client, ChatAccess.AccessFailed>
  readonly boot: SubscriptionRef.SubscriptionRef<ChatAccess.Boot>
  readonly status: SubscriptionRef.SubscriptionRef<Connection.Status>
  readonly retryAt: SubscriptionRef.SubscriptionRef<number>
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
  return {
    sessionId,
    client: access.client,
    boot: access.boot,
    status: connection.status,
    retryAt: connection.retryAt,
    frames: publishing.withPermit(
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
    ),
    wake: connection.wake,
    lost: access.lost,
  } satisfies Link
})

export class Service extends Context.Service<
  Service,
  { readonly open: (sessionId: Session.ID) => Effect.Effect<Link, never, Scope.Scope> }
>()("@ren/opencode/Link") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const links = yield* RcMap.make({ lookup: make })
    return Service.of({ open: (sessionId) => RcMap.get(links, sessionId) })
  }),
)
