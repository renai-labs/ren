export * as TestAccess from "./access.js"

import type { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Ref } from "effect"
import { EnvironmentAccess } from "../../src/environment/access.js"

const notFound = (sessionId: Session.ID) =>
  new EnvironmentAccess.NotFound({ sessionId, message: `Session ${sessionId} has no access to an environment` })

const found = (accesses: ReadonlyMap<Session.ID, Environment.Access>, sessionId: Session.ID) => {
  const access = accesses.get(sessionId)
  return access ? Effect.succeed(access) : Effect.fail(notFound(sessionId))
}

export const fixed = (accesses: ReadonlyMap<Session.ID, Environment.Access>) =>
  Layer.succeed(
    EnvironmentAccess.Service,
    EnvironmentAccess.Service.of({ open: (sessionId) => found(accesses, sessionId), release: () => Effect.void }),
  )

export interface MemoryInterface {
  readonly set: (sessionId: Session.ID, access: Environment.Access) => Effect.Effect<void>
  readonly remove: (sessionId: Session.ID) => Effect.Effect<void>
}

export class Memory extends Context.Service<Memory, MemoryInterface>()("@ren/brain/TestAccess/Memory") {}

export const memory = (initial: ReadonlyMap<Session.ID, Environment.Access>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const accesses = yield* Ref.make<ReadonlyMap<Session.ID, Environment.Access>>(new Map(initial))
      const update = (change: (next: Map<Session.ID, Environment.Access>) => void) =>
        Ref.update(accesses, (current) => {
          const next = new Map(current)
          change(next)
          return next
        })
      return Context.make(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          release: () => Effect.void,
          open: (sessionId) => Effect.flatMap(Ref.get(accesses), (current) => found(current, sessionId)),
        }),
      ).pipe(
        Context.add(
          Memory,
          Memory.of({
            set: (sessionId, access) => update((next) => next.set(sessionId, access)),
            remove: (sessionId) => update((next) => next.delete(sessionId)),
          }),
        ),
      )
    }),
  )
