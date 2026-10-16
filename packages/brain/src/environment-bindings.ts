export * as EnvironmentBindings from "./environment-bindings.js"

import { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { KeyValueStore } from "effect/persistence"
import { Environments } from "./environments.js"

export interface Binding extends Schema.Schema.Type<typeof Binding> {}
export const Binding = Schema.Struct({
  sessionDirectory: Schema.String.check(Schema.isStartingWith("/")),
  location: Schema.NullOr(Environment.Location),
}).annotate({ identifier: "EnvironmentBindings.Binding" })

export class Unusable extends Schema.TaggedError<Unusable>()("EnvironmentBindings.Unusable", {
  environmentId: Environment.ID,
  message: Schema.String,
}) {}

export interface Interface {
  readonly get: (session: Session.ID) => Effect.Effect<Option.Option<Binding>>
  readonly set: (session: Session.ID, binding: Binding) => Effect.Effect<void, Unusable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/EnvironmentBindings") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environments = yield* Environments.Service
    const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Binding)
    const bindings = yield* Ref.make(new Map<Session.ID, Option.Option<Binding>>())
    const check = Effect.fn("EnvironmentBindings.check")(function* (location: Environment.Location) {
      const unusable = (message: string) => new Unusable({ environmentId: location.environmentId, message })
      const connection = yield* environments
        .connect(location.environmentId)
        .pipe(Effect.mapError((error) => unusable(error.message)))
      const info = yield* connection.client["files.stat"]({ path: location.directory }).pipe(
        Effect.mapError((error) =>
          unusable(
            error._tag === "FileNotFoundError"
              ? `The directory ${location.directory} does not exist on environment ${location.environmentId}`
              : `Could not check the directory ${location.directory}: ${error.message}`,
          ),
        ),
      )
      if (info.type !== "directory")
        return yield* unusable(`${location.directory} on environment ${location.environmentId} is not a directory`)
    }, Effect.scoped)
    return Service.of({
      get: Effect.fn("EnvironmentBindings.get")(function* (session: Session.ID) {
        const cached = (yield* Ref.get(bindings)).get(session)
        if (cached) return cached
        const stored = yield* store.get(session).pipe(Effect.orDie)
        return yield* Ref.modify(bindings, (current) => {
          const latest = current.get(session)
          return latest ? [latest, current] : [stored, new Map(current).set(session, stored)]
        })
      }),
      set: Effect.fn("EnvironmentBindings.set")(function* (session: Session.ID, binding: Binding) {
        if (binding.location) yield* check(binding.location)
        yield* store.set(session, binding).pipe(Effect.orDie)
        yield* Ref.update(bindings, (current) => new Map(current).set(session, Option.some(binding)))
      }),
    })
  }),
)
