export * as EnvironmentAccess from "./environment-access.js"

import { Environment } from "@ren/schema/environment"
import { Context, Effect, Layer, PubSub, Ref, Schema, type Scope, Stream } from "effect"

export class NotFound extends Schema.TaggedError<NotFound>()("EnvironmentAccess.NotFound", {
  environmentId: Environment.ID,
}) {}

export interface Interface {
  readonly open: (id: Environment.ID) => Effect.Effect<Environment.Access, NotFound>
  readonly subscribe: Effect.Effect<Stream.Stream<Environment.ID>, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/EnvironmentAccess") {}

export interface MemoryInterface {
  readonly set: (access: Environment.Access) => Effect.Effect<void>
  readonly remove: (id: Environment.ID) => Effect.Effect<void>
}

export class Memory extends Context.Service<Memory, MemoryInterface>()("@ren/brain/EnvironmentAccess/Memory") {}

export const layerFixed = (accesses: ReadonlyArray<Environment.Access>) =>
  Layer.succeed(
    Service,
    Service.of({
      open: (id) => {
        const access = accesses.find((candidate) => candidate.environmentId === id)
        return access ? Effect.succeed(access) : Effect.fail(new NotFound({ environmentId: id }))
      },
      subscribe: Effect.succeed(Stream.never),
    }),
  )

export const layerMemory = (initial: ReadonlyArray<Environment.Access>) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const accesses = yield* Ref.make(new Map(initial.map((access) => [access.environmentId, access])))
      const changed = yield* PubSub.unbounded<Environment.ID>()
      const update = (id: Environment.ID, change: (next: Map<Environment.ID, Environment.Access>) => void) =>
        Ref.update(accesses, (current) => {
          const next = new Map(current)
          change(next)
          return next
        }).pipe(Effect.andThen(PubSub.publish(changed, id)), Effect.asVoid)
      return Context.make(
        Service,
        Service.of({
          open: (id) =>
            Ref.get(accesses).pipe(
              Effect.flatMap((current) => {
                const access = current.get(id)
                return access ? Effect.succeed(access) : Effect.fail(new NotFound({ environmentId: id }))
              }),
            ),
          subscribe: PubSub.subscribe(changed).pipe(Effect.map(Stream.fromSubscription)),
        }),
      ).pipe(
        Context.add(
          Memory,
          Memory.of({
            set: (access) => update(access.environmentId, (next) => next.set(access.environmentId, access)),
            remove: (id) => update(id, (next) => next.delete(id)),
          }),
        ),
      )
    }),
  )
