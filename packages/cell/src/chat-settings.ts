export * as ChatSettings from "./chat-settings.js"

import { BrainSettings } from "@ren/brain/settings"
import type { PullChat } from "@ren/host-api/ren-host-api"
import { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Settings } from "@ren/schema/settings"
import { Context, Effect, Layer, Option, Ref, Result, Schema } from "effect"
import { BrainStorage } from "./brain-storage.js"

const layersKey = "ren:settings-layers"
const chatsKey = "ren:chats"
const resolvedKey = "ren:chat-settings"

const StoredResolved = Schema.fromJsonString(Schema.Record(Schema.String, BrainSettings.ChatSettings))

const StoredLayers = Schema.fromJsonString(
  Schema.Struct({
    ren: SessionSettings.Layer,
    organization: SessionSettings.Layer,
    space: SessionSettings.Layer,
    agents: Schema.Array(Schema.Struct({ ...SessionSettings.AgentLayer.fields, settings: Settings.Info })),
  }),
)

const StoredChats = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ id: Session.ID, agent: Schema.NullOr(Schema.String), archived: Schema.Boolean })),
)

export interface Interface {
  readonly layers: Effect.Effect<BrainSettings.Layers>
  readonly chats: Effect.Effect<ReadonlyArray<PullChat>>
  readonly save: (layers: BrainSettings.Layers, chats: ReadonlyArray<PullChat>) => Effect.Effect<void>
  readonly saved: Effect.Effect<ReadonlyMap<string, BrainSettings.Chat>>
  readonly keep: (sessionId: string, chat: BrainSettings.Chat) => Effect.Effect<void>
  readonly resolve: (
    sessionId: string,
    model: Option.Option<Session.Model>,
    lookup: BrainSettings.Lookup,
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
          text === undefined ? fallback : Option.getOrElse(Schema.decodeUnknownOption(schema)(text), () => fallback),
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
        yield* Ref.set(layers, nextLayers)
        yield* Ref.set(chats, nextChats)
        yield* Effect.promise(() => storage.put(layersKey, Schema.encodeSync(StoredLayers)(nextLayers)))
        yield* Effect.promise(() => storage.put(chatsKey, Schema.encodeSync(StoredChats)(nextChats)))
      }),
      saved: Ref.get(saved),
      keep: Effect.fn("ChatSettings.keep")(function* (sessionId, chat) {
        const next = yield* Ref.updateAndGet(saved, (all) => new Map([...all, [sessionId, chat]]))
        yield* Effect.promise(() =>
          storage.put(resolvedKey, Schema.encodeSync(StoredResolved)(Object.fromEntries(next))),
        )
      }),
      resolve: Effect.fn("ChatSettings.resolve")(function* (sessionId, model, lookup) {
        const chat = (yield* Ref.get(chats)).find((each) => each.id === sessionId)
        return yield* Result.match(
          BrainSettings.resolve(yield* Ref.get(layers), { agent: chat?.agent ?? null, model }, lookup),
          { onFailure: Effect.fail, onSuccess: Effect.succeed },
        )
      }),
    })
  }),
)
