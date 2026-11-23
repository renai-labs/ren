export * as Binding from "./binding.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Context, Effect, Layer, Option, Schema } from "effect"
import type { RenAuth } from "./auth.js"
import { RenApi } from "./ren.js"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({ spaceId: Space.ID, sessionId: Session.ID })

export const LocalID = Schema.String.pipe(Schema.brand("SessionID"))

const Metadata = Schema.Struct({ ren: Info })

const Options = Schema.Struct({ space: Schema.optional(Schema.String) })

export class LocalError extends Schema.TaggedError<LocalError>()("Binding.LocalError", { message: Schema.String }) {}

export class NoSpace extends Schema.TaggedError<NoSpace>()("Binding.NoSpace", { message: Schema.String }) {}

export class Service extends Context.Service<
  Service,
  {
    readonly get: (sessionID: Session.ID) => Effect.Effect<Option.Option<Info>, LocalError>
    readonly set: (sessionID: Session.ID, info: Info) => Effect.Effect<void, LocalError>
    readonly space: Effect.Effect<Space.ID, NoSpace | RenAuth.SignedOut | RenAuth.AuthError>
  }
>()("@ren/opencode/Binding") {}

export const layer = (session: Plugin.Context["session"], options: Readonly<Record<string, unknown>>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const ren = yield* RenApi.Service
      const selected = Schema.decodeUnknownOption(Options)(options).pipe(
        Option.flatMapNullishOr((value) => value.space),
      )
      const local = (sessionID: Session.ID) =>
        session
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
          yield* session
            .update({
              sessionID: current.id,
              metadata: { ...current.metadata, ren: { spaceId: info.spaceId, sessionId: info.sessionId } },
            })
            .pipe(Effect.mapError(() => new LocalError({ message: `Could not save the Ren session of ${sessionID}.` })))
        }),
        space: Effect.gen(function* () {
          const client = yield* ren.client
          if (Option.isNone(selected)) {
            const page = yield* client.space
              .list({ joined: true, page: 1, pageSize: 1 })
              .pipe(Effect.mapError(() => new NoSpace({ message: "Could not list your Ren spaces." })))
            const first = page.items.at(0)
            if (!first) return yield* new NoSpace({ message: "Join a Ren space first." })
            return first.id
          }
          if (Schema.is(Space.ID)(selected.value)) return selected.value
          return (yield* client.space
            .get({ idOrSlug: selected.value })
            .pipe(Effect.mapError(() => new NoSpace({ message: `Ren has no space ${selected.value} for you.` })))).id
        }).pipe(Effect.withSpan("Binding.space")),
      })
    }),
  )
