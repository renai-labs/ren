export * as ChannelProvider from "./channel-provider.js"

import type { Channel } from "@ren/schema/channel"
import { Context, Effect, Layer, Option, Schema } from "effect"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("ChannelProvider.Unauthorized", {
  message: Schema.String,
}) {}

export class Malformed extends Schema.TaggedError<Malformed>()("ChannelProvider.Malformed", {
  message: Schema.String,
}) {}

export class FileUnavailable extends Schema.TaggedError<FileUnavailable>()("ChannelProvider.FileUnavailable", {
  message: Schema.String,
}) {}

export class InstallFailed extends Schema.TaggedError<InstallFailed>()("ChannelProvider.InstallFailed", {
  message: Schema.String,
}) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("ChannelProvider.Unavailable", {
  message: Schema.String,
}) {}

export class PlaceGone extends Schema.TaggedError<PlaceGone>()("ChannelProvider.PlaceGone", {
  message: Schema.String,
}) {}

export class Rejected extends Schema.TaggedError<Rejected>()("ChannelProvider.Rejected", {
  message: Schema.String,
}) {}

export interface Target {
  readonly install: string
  readonly place: string
  readonly thread: string
  readonly message: string
}

export interface Request {
  readonly headers: Headers
  readonly body: string
}

export interface Installed {
  readonly workspace: string
  readonly name: string
  readonly botUser?: string
}

export interface Provider {
  readonly id: Channel.Provider
  readonly verify: (request: Request) => Effect.Effect<void, Unauthorized>
  readonly parse: (request: Request) => Effect.Effect<Channel.Parsed, Malformed>
  readonly fetchFile: (install: string, file: Channel.FileRef) => Effect.Effect<Uint8Array, FileUnavailable>
  readonly context: (event: Channel.Event) => Effect.Effect<Option.Option<string>, Unavailable>
  readonly send: (target: Target, text: string) => Effect.Effect<void, PlaceGone | Unavailable | Rejected>
  readonly installUrl: (state: string) => string
  readonly completeInstall: (query: Readonly<Record<string, string>>) => Effect.Effect<Installed, InstallFailed>
  readonly changedOnProvider: (query: Readonly<Record<string, string>>) => boolean
  readonly revoke: (workspace: string) => Effect.Effect<void, Unavailable>
}

export class Registry extends Context.Service<
  Registry,
  { readonly providers: ReadonlyArray<Provider>; readonly get: (id: string) => Option.Option<Provider> }
>()("@ren/core/ChannelProvider/Registry") {}

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<Option.Option<Provider>, E, R>>) =>
  Layer.effect(
    Registry,
    Effect.gen(function* () {
      const all = (yield* Effect.all(providers)).flatMap(Option.toArray)
      const ids = all.map((provider) => provider.id)
      if (new Set(ids).size !== ids.length)
        return yield* Effect.die(new Error(`Two channel providers share an id: ${ids.join(", ")}`))
      return Registry.of({
        providers: all,
        get: (id) => Option.fromNullishOr(all.find((provider) => provider.id === id)),
      })
    }),
  )
