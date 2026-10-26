export * as ChannelProvider from "./channel-provider.js"

import type { Channel } from "@ren/schema/channel"
import type { TaskLink } from "@ren/schema/task-link"
import { Context, Effect, Layer, Option, type Redacted, Schema } from "effect"
import type { PersonCredentials } from "./person-credentials.js"

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

export type Status = "received" | "done" | "failed"

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
  readonly secret?: Redacted.Redacted
  readonly installer?: {
    readonly accountId: string
    readonly credential?: PersonCredentials.Saved
  }
}

export interface Place {
  readonly id: string
  readonly name: string
  readonly private: boolean
  readonly anyoneCanWrite: boolean
  readonly description?: string
  readonly url?: string
}

export interface Provider {
  readonly id: Channel.Provider
  readonly triggers: ReadonlyArray<Channel.Trigger>
  readonly replyTool?: string
  readonly verify: (request: Request) => Effect.Effect<void, Unauthorized>
  readonly parse: (request: Request) => Effect.Effect<Channel.Parsed, Malformed>
  readonly enrich?: (event: Channel.Event) => Effect.Effect<Channel.Event>
  readonly fetchFile: (install: string, file: Channel.FileRef) => Effect.Effect<Uint8Array, FileUnavailable>
  readonly context: (event: Channel.Event) => Effect.Effect<Option.Option<string>, Unavailable>
  readonly linkOf: (event: Channel.Event) => Option.Option<TaskLink.Ref>
  readonly send: (target: Target, text: string) => Effect.Effect<void, PlaceGone | Unavailable | Rejected>
  readonly progress: (target: Target, status: Status) => Effect.Effect<void, Unavailable>
  readonly email: (
    install: string,
    sender: Channel.Event["sender"],
  ) => Effect.Effect<Option.Option<string>, Unavailable>
  readonly installUrl: (state: string, accounts: ReadonlyArray<string>) => string
  readonly completeInstall: (
    query: Readonly<Record<string, string>>,
    accounts: ReadonlyArray<string>,
  ) => Effect.Effect<Installed, InstallFailed>
  readonly changedOnProvider: (query: Readonly<Record<string, string>>) => boolean
  readonly revoke: (workspace: string) => Effect.Effect<void, Unavailable>
  readonly places: (workspace: string) => Effect.Effect<ReadonlyArray<Place>, Unavailable>
  readonly place: (workspace: string, id: string) => Effect.Effect<Option.Option<Place>, Unavailable>
  readonly announce: (
    workspace: string,
    place: Place,
    text: string,
  ) => Effect.Effect<void, PlaceGone | Unavailable | Rejected>
}

export class Registry extends Context.Service<
  Registry,
  { readonly providers: ReadonlyArray<Provider>; readonly get: (id: string) => Option.Option<Provider> }
>()("@ren/core/ChannelProvider/Registry") {}

export const layer = <E, R>(providers: Effect.Effect<ReadonlyArray<Option.Option<Provider>>, E, R>) =>
  Layer.effect(
    Registry,
    Effect.gen(function* () {
      const all = (yield* providers).flatMap(Option.toArray)
      const ids = all.map((provider) => provider.id)
      if (new Set(ids).size !== ids.length)
        return yield* Effect.die(new Error(`Two channel providers share an id: ${ids.join(", ")}`))
      return Registry.of({
        providers: all,
        get: (id) => Option.fromNullishOr(all.find((provider) => provider.id === id)),
      })
    }),
  )
