export * as EnvironmentAccess from "./environment-access.js"

import type { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, PubSub, Ref, Schema, type Scope, Stream } from "effect"

export class NotFound extends Schema.TaggedError<NotFound>()("EnvironmentAccess.NotFound", {
  sessionId: Session.ID,
  message: Schema.String,
}) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("EnvironmentAccess.Unavailable", {
  sessionId: Session.ID,
  message: Schema.String,
}) {}

export interface Interface {
  readonly open: (sessionId: Session.ID) => Effect.Effect<Environment.Access, NotFound | Unavailable>
  readonly subscribe: Effect.Effect<Stream.Stream<Session.ID>, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/EnvironmentAccess") {}

export interface MemoryInterface {
  readonly set: (sessionId: Session.ID, access: Environment.Access) => Effect.Effect<void>
  readonly remove: (sessionId: Session.ID) => Effect.Effect<void>
}

export class Memory extends Context.Service<Memory, MemoryInterface>()("@ren/brain/EnvironmentAccess/Memory") {}

const notFound = (sessionId: Session.ID) =>
  new NotFound({ sessionId, message: `Session ${sessionId} has no access to an environment` })

export const layerFixed = (accesses: ReadonlyMap<Session.ID, Environment.Access>) =>
  Layer.succeed(
    Service,
    Service.of({
      open: (sessionId) => {
        const access = accesses.get(sessionId)
        return access ? Effect.succeed(access) : Effect.fail(notFound(sessionId))
      },
      subscribe: Effect.succeed(Stream.never),
    }),
  )

export const layerMemory = (initial: ReadonlyMap<Session.ID, Environment.Access>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const accesses = yield* Ref.make(new Map(initial))
      const changed = yield* PubSub.unbounded<Session.ID>()
      const update = (sessionId: Session.ID, change: (next: Map<Session.ID, Environment.Access>) => void) =>
        Ref.update(accesses, (current) => {
          const next = new Map(current)
          change(next)
          return next
        }).pipe(Effect.andThen(PubSub.publish(changed, sessionId)), Effect.asVoid)
      return Context.make(
        Service,
        Service.of({
          open: (sessionId) =>
            Ref.get(accesses).pipe(
              Effect.flatMap((current) => {
                const access = current.get(sessionId)
                return access ? Effect.succeed(access) : Effect.fail(notFound(sessionId))
              }),
            ),
          subscribe: PubSub.subscribe(changed).pipe(Effect.map(Stream.fromSubscription)),
        }),
      ).pipe(
        Context.add(
          Memory,
          Memory.of({
            set: (sessionId, access) => update(sessionId, (next) => next.set(sessionId, access)),
            remove: (sessionId) => update(sessionId, (next) => next.delete(sessionId)),
          }),
        ),
      )
    }),
  )
