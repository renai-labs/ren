export * as TestAccess from "./access.js"

import type { Hand } from "@ren/schema/hand"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Ref } from "effect"
import { HandAccess } from "../../src/hand-access.js"

const notFound = (sessionId: Session.ID) =>
  new HandAccess.NotFound({ sessionId, message: `Session ${sessionId} has no access to an environment` })

const found = (accesses: ReadonlyMap<Session.ID, Hand.Access>, sessionId: Session.ID) => {
  const access = accesses.get(sessionId)
  return access ? Effect.succeed(access) : Effect.fail(notFound(sessionId))
}

export const fixed = (accesses: ReadonlyMap<Session.ID, Hand.Access>) =>
  Layer.succeed(
    HandAccess.Service,
    HandAccess.Service.of({ open: (sessionId) => found(accesses, sessionId), release: () => Effect.void }),
  )

export interface MemoryInterface {
  readonly set: (sessionId: Session.ID, access: Hand.Access) => Effect.Effect<void>
  readonly remove: (sessionId: Session.ID) => Effect.Effect<void>
}

export class Memory extends Context.Service<Memory, MemoryInterface>()("@ren/brain/TestAccess/Memory") {}

export const memory = (initial: ReadonlyMap<Session.ID, Hand.Access>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const accesses = yield* Ref.make<ReadonlyMap<Session.ID, Hand.Access>>(new Map(initial))
      const update = (change: (next: Map<Session.ID, Hand.Access>) => void) =>
        Ref.update(accesses, (current) => {
          const next = new Map(current)
          change(next)
          return next
        })
      return Context.make(
        HandAccess.Service,
        HandAccess.Service.of({
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
