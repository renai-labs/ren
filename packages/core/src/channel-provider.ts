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

export interface Request {
  readonly headers: Headers
  readonly body: string
}

export interface Provider {
  readonly id: Channel.Provider
  readonly verify: (request: Request) => Effect.Effect<void, Unauthorized>
  readonly parse: (request: Request) => Effect.Effect<Channel.Parsed, Malformed>
  readonly fetchFile: (install: string, file: Channel.FileRef) => Effect.Effect<Uint8Array, FileUnavailable>
}

export class Registry extends Context.Service<
  Registry,
  { readonly providers: ReadonlyArray<Provider>; readonly get: (id: string) => Option.Option<Provider> }
>()("@ren/core/ChannelProvider/Registry") {}

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<Provider, E, R>>) =>
  Layer.effect(
    Registry,
    Effect.gen(function* () {
      const all = yield* Effect.all(providers)
      const ids = all.map((provider) => provider.id)
      if (new Set(ids).size !== ids.length)
        return yield* Effect.die(new Error(`Two channel providers share an id: ${ids.join(", ")}`))
      return Registry.of({
        providers: all,
        get: (id) => Option.fromNullishOr(all.find((provider) => provider.id === id)),
      })
    }),
  )
