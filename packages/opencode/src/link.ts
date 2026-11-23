export * as Link from "./link.js"

import { ChatAccess } from "@ren/chat/chat-access"
import type { Connection } from "@ren/chat/connection"
import type { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import { Context, Effect, Layer, PubSub, RcMap, type Scope, Stream, type SubscriptionRef } from "effect"
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
  const access = yield* ChatAccess.make({
    access: (input) =>
      Effect.flatMap(ren.client, (client) =>
        client.chat.access({ id: sessionId, ...(input.unreachable && { unreachable: "true" as const }) }),
      ),
  })
  const connection = yield* ChatAccess.connect(access, {
    flushInterval: 0,
    onFrames: (batch) => PubSub.publishAll(frames, batch).pipe(Effect.asVoid),
  })
  return {
    sessionId,
    client: access.client,
    boot: access.boot,
    status: connection.status,
    retryAt: connection.retryAt,
    frames: Effect.map(PubSub.subscribe(frames), Stream.fromSubscription),
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
