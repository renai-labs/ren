export * as Binding from "./binding.js"

import { Model, type Plugin, Provider } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session/model"
import { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Option, Schema } from "effect"
import type { RenAuth } from "./auth.js"
import { RenApi } from "./ren.js"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({ spaceId: Space.ID, sessionId: Schema.optionalKey(Session.ID) })

export const LocalID = Schema.String.pipe(Schema.brand("SessionID"))

export const LocalMessageID = Schema.String.pipe(Schema.brand("Session.Message.ID"))

const Metadata = Schema.Struct({ ren: Info })

const Options = Schema.Struct({ space: Schema.optional(Schema.String) })

const selection = "space"

export class LocalError extends Schema.TaggedError<LocalError>()("Binding.LocalError", { message: Schema.String }) {}

export class NoSpace extends Schema.TaggedError<NoSpace>()("Binding.NoSpace", { message: Schema.String }) {}

export class Service extends Context.Service<
  Service,
  {
    readonly get: (sessionID: Session.ID) => Effect.Effect<Option.Option<Info>, LocalError>
    readonly set: (sessionID: Session.ID, info: Info) => Effect.Effect<void, LocalError>
    readonly create: (spaceId: Space.ID, model: SessionModel.Ref) => Effect.Effect<string, LocalError>
    readonly space: Effect.Effect<Space.ID, NoSpace | RenAuth.SignedOut | RenAuth.AuthError>
    readonly select: (spaceId: Space.ID) => Effect.Effect<void>
  }
>()("@ren/opencode/Binding") {}

export const layer = (ctx: Pick<Plugin.Context, "session" | "storage" | "options">) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const ren = yield* RenApi.Service
      const option = Schema.decodeUnknownOption(Options)(ctx.options).pipe(
        Option.flatMapNullishOr((value) => value.space),
      )
      const local = (sessionID: Session.ID) =>
        ctx.session
          .get({ sessionID: LocalID.make(sessionID) })
          .pipe(Effect.mapError(() => new LocalError({ message: `Could not read the local session ${sessionID}.` })))
      return Service.of({
        get: Effect.fn("Binding.get")(function* (sessionID) {
          return Option.map(
            Schema.decodeUnknownOption(Metadata)((yield* local(sessionID)).metadata),
            (found) => found.ren,
          )
        }),
        set: Effect.fn("Binding.set")(function* (sessionID, info) {
          const current = yield* local(sessionID)
          yield* ctx.session
            .update({
              sessionID: current.id,
              metadata: { ...current.metadata, ren: info },
            })
            .pipe(Effect.mapError(() => new LocalError({ message: `Could not save the Ren session of ${sessionID}.` })))
        }),
        create: Effect.fn("Binding.create")(function* (spaceId, model) {
          return (yield* ctx.session
            .create({
              model: {
                providerID: Provider.ID.make("ren"),
                id: Model.ID.make(SessionModel.key(model)),
                ...(model.variant && { variant: Model.VariantID.make(model.variant) }),
              },
              metadata: { ren: { spaceId } },
            })
            .pipe(Effect.mapError(() => new LocalError({ message: "Could not create a local session." })))).id
        }),
        space: Effect.gen(function* () {
          const stored = Schema.decodeUnknownOption(Space.ID)(yield* ctx.storage.get(selection))
          if (Option.isSome(stored)) return stored.value
          const client = yield* ren.client
          if (Option.isNone(option)) {
            const page = yield* client.space
              .list({ joined: true, page: 1, pageSize: 1 })
              .pipe(Effect.mapError(() => new NoSpace({ message: "Could not list your Ren spaces." })))
            const first = page.items.at(0)
            if (!first) return yield* new NoSpace({ message: "Join a Ren space first." })
            return first.id
          }
          if (Schema.is(Space.ID)(option.value)) return option.value
          return (yield* client.space
            .get({ idOrSlug: option.value })
            .pipe(Effect.mapError(() => new NoSpace({ message: `Ren has no space ${option.value} for you.` })))).id
        }).pipe(Effect.withSpan("Binding.space")),
        select: (spaceId) => ctx.storage.set(selection, spaceId).pipe(Effect.withSpan("Binding.select")),
      })
    }),
  )
