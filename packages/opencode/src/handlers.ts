export * as RenHandlers from "./handlers.js"

import type { Plugin, Rpc } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session/model"
import type { Space } from "@ren/schema/space"
import { Deferred, Effect, Schema, Scope, Struct } from "effect"
import { RenAuth } from "./auth.js"
import { Binding } from "./binding.js"
import { RenApi } from "./ren.js"
import { RenRpc } from "./rpc.js"

class Unavailable extends Schema.TaggedError<Unavailable>()("RenHandlers.Unavailable", { message: Schema.String }) {}

type Methods = (typeof RenRpc.Definition)["methods"]

const answer =
  (context: { readonly error: Rpc.ErrorFactory<Methods["getSpace"]> }) =>
  (error: RenAuth.SignedOut | { readonly message: string }) =>
    error instanceof RenAuth.SignedOut
      ? context.error("signed_out", error.message, { server: error.server })
      : context.error("unavailable", error.message, {})

const info = (space: Space.Info): RenRpc.SpaceInfo => Struct.pick(space, ["id", "slug", "name", "kind", "description"])

export const register = Effect.fn("RenHandlers.register")(function* (
  ctx: Plugin.Context,
  refresh: Effect.Effect<void>,
) {
  const ren = yield* RenApi.Service
  const bindings = yield* Binding.Service
  const scope = yield* Scope.Scope
  const emitter = yield* Deferred.make<(space: RenRpc.SpaceInfo) => Effect.Effect<void, unknown>>()
  const find = (spaceId: Space.ID) =>
    Effect.flatMap(ren.client, (client) =>
      client.space
        .get({ idOrSlug: spaceId })
        .pipe(Effect.mapError(() => new Unavailable({ message: `Ren has no space ${spaceId} for you.` }))),
    )
  const prepare = (spaceId: Space.ID) =>
    Effect.flatMap(ren.client, (client) => client.chat.prepare({ id: spaceId })).pipe(
      Effect.ignore,
      Effect.forkIn(scope),
    )
  const registration = yield* ctx.rpc.register(RenRpc.Definition, {
    listSpaces: (_input, context) =>
      Effect.gen(function* () {
        const client = yield* ren.client
        const page = yield* client.space
          .list({ joined: true, page: 1, pageSize: 100 })
          .pipe(Effect.mapError(() => new Unavailable({ message: "Could not list your Ren spaces." })))
        const selected = yield* bindings.space.pipe(Effect.catchTag("Binding.NoSpace", () => Effect.succeed(null)))
        return { spaces: page.items.map(info), selected }
      }).pipe(Effect.mapError(answer(context))),
    getSpace: (_input, context) =>
      Effect.flatMap(bindings.space, find).pipe(Effect.map(info), Effect.mapError(answer(context))),
    selectSpace: (input, context) =>
      Effect.gen(function* () {
        const space = info(yield* find(input.spaceId))
        yield* bindings.select(space.id)
        yield* prepare(space.id)
        yield* refresh
        const emit = yield* Deferred.await(emitter)
        yield* emit(space).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Could not announce the Ren space", cause)),
        )
        return space
      }).pipe(Effect.mapError(answer(context))),
    createSession: (input, context) =>
      Effect.gen(function* () {
        const spaceId = yield* bindings.space
        const client = yield* ren.client
        const choices = yield* client.chat
          .models({ id: Session.ID.create(), spaceId })
          .pipe(Effect.mapError(() => new Unavailable({ message: "Could not list the models of the Ren space." })))
        const wanted = choices.models.find((choice) => SessionModel.key(choice) === input.model?.id)
        const variant = input.model?.variant
        const first = choices.models.at(0)
        const model = wanted
          ? {
              providerID: wanted.providerID,
              id: wanted.id,
              ...(variant && wanted.variants.some((each) => each.id === variant) && { variant }),
            }
          : (choices.default ?? (first && { providerID: first.providerID, id: first.id }))
        if (!model) return yield* new Unavailable({ message: "The Ren space offers no models." })
        yield* prepare(spaceId)
        return { sessionID: yield* bindings.create(spaceId, model), spaceId }
      }).pipe(Effect.mapError(answer(context))),
  })
  yield* Deferred.succeed(emitter, (space) => registration.events.emit("spaceSelected", space))
})
