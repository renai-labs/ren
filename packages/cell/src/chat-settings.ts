export * as ChatSettings from "./chat-settings.js"

import { BrainSettings } from "@ren/brain/settings"
import type { ModelTypes } from "@ren/schema/model-types"
import { PullChat } from "@ren/host-api/ren-host-api"
import { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Context, Effect, Layer, Option, Ref, Result, Schema } from "effect"
import { BrainStorage } from "./brain-storage.js"

const layersKey = "ren:settings-layers"
const chatsKey = "ren:chats"
const resolvedKey = "ren:chat-settings"

const StoredResolved = Schema.fromJsonString(Schema.Record(Schema.String, BrainSettings.ChatSettings))

const StoredLayers = Schema.fromJsonString(SessionSettings.Layers)

const StoredChats = Schema.fromJsonString(Schema.Array(PullChat))

export interface Interface {
  readonly layers: Effect.Effect<BrainSettings.Layers>
  readonly chats: Effect.Effect<ReadonlyArray<PullChat>>
  readonly save: (layers: BrainSettings.Layers, chats: ReadonlyArray<PullChat>) => Effect.Effect<boolean>
  readonly saved: Effect.Effect<ReadonlyMap<string, BrainSettings.Chat>>
  readonly keep: (sessionId: string, chat: BrainSettings.Chat) => Effect.Effect<void>
  readonly resolve: (
    sessionId: string,
    model: Option.Option<Session.Model>,
    lookup: BrainSettings.Lookup,
    defaults?: {
      readonly models?: ModelTypes.Defaults | undefined
      readonly catalogs: ModelTypes.Catalogs
    },
  ) => Effect.Effect<BrainSettings.Resolved, BrainSettings.Unconfigured>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/ChatSettings") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const read = <A>(key: string, schema: Schema.Codec<A, string>, fallback: A) =>
      Effect.promise(() => storage.get(key)).pipe(
        Effect.map((text) =>
          !text ? fallback : Option.getOrElse(Schema.decodeUnknownOption(schema)(text), () => fallback),
        ),
      )
    const layers = yield* Ref.make<BrainSettings.Layers>(yield* read(layersKey, StoredLayers, BrainSettings.empty))
    const chats = yield* Ref.make<ReadonlyArray<PullChat>>(yield* read(chatsKey, StoredChats, []))
    const saved = yield* Ref.make<ReadonlyMap<string, BrainSettings.Chat>>(
      new Map(Object.entries(yield* read(resolvedKey, StoredResolved, {}))),
    )
    return Service.of({
      layers: Ref.get(layers),
      chats: Ref.get(chats),
      save: Effect.fn("ChatSettings.save")(function* (nextLayers, nextChats) {
        const encodedLayers = Schema.encodeSync(StoredLayers)(nextLayers)
        const encodedChats = Schema.encodeSync(StoredChats)(nextChats)
        if (
          Schema.encodeSync(StoredLayers)(yield* Ref.get(layers)) === encodedLayers &&
          Schema.encodeSync(StoredChats)(yield* Ref.get(chats)) === encodedChats
        )
          return false
        yield* Ref.set(layers, nextLayers)
        yield* Ref.set(chats, nextChats)
        yield* Effect.promise(() => storage.put(layersKey, encodedLayers))
        yield* Effect.promise(() => storage.put(chatsKey, encodedChats))
        return true
      }),
      saved: Ref.get(saved),
      keep: Effect.fn("ChatSettings.keep")(function* (sessionId, chat) {
        const next = yield* Ref.updateAndGet(saved, (all) => new Map([...all, [sessionId, chat]]))
        yield* Effect.promise(() =>
          storage.put(resolvedKey, Schema.encodeSync(StoredResolved)(Object.fromEntries(next))),
        )
      }),
      resolve: Effect.fn("ChatSettings.resolve")(function* (sessionId, model, lookup, defaults) {
        const chat = (yield* Ref.get(chats)).find((each) => each.id === sessionId)
        return yield* Result.match(
          BrainSettings.resolve(
            yield* Ref.get(layers),
            { agent: chat?.agent ?? null, model, drives: chat?.drives, defaultModels: defaults?.models },
            lookup,
            defaults?.catalogs,
          ),
          { onFailure: Effect.fail, onSuccess: Effect.succeed },
        )
      }),
    })
  }),
)
