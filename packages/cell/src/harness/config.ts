export * as HarnessConfig from "./config.js"

import type { BrainSettings } from "@ren/brain/settings"
import type { PullChat, PullMemory } from "@ren/host-api/ren-host-api"
import type { AppCatalog } from "@ren/schema/app-catalog"
import type { Channel } from "@ren/schema/channel"
import type { Models } from "@ren/schema/models"
import type { ModelTypes } from "@ren/schema/model-types"
import type { Effect, Option } from "effect"

export interface Update {
  readonly models?: ReadonlyArray<Models.Endpoint>
  readonly modelCatalogs?: ModelTypes.Catalogs
  readonly modelProviders?: ModelTypes.Providers
  readonly apps?: Option.Option<AppCatalog.Info>
  readonly channels?: ReadonlyArray<Channel.Provider>
  readonly memory?: Option.Option<PullMemory>
  readonly settings?: {
    readonly layers: BrainSettings.Layers
    readonly chats: ReadonlyArray<PullChat>
  }
}

export interface Snapshot {
  readonly revision: number
  readonly models: ReadonlyArray<Models.Endpoint>
  readonly modelCatalogs: ModelTypes.Catalogs
  readonly modelProviders: ModelTypes.Providers
  readonly apps: Option.Option<AppCatalog.Info>
  readonly channels: ReadonlyArray<Channel.Provider>
  readonly memory: Option.Option<PullMemory>
  readonly chats: ReadonlyMap<string, BrainSettings.Chat>
}

export interface Observation {
  readonly directory: string
  readonly workspaceID?: string | undefined
  readonly desiredRevision: number
  readonly appliedRevision: number
  readonly appFingerprint: Option.Option<string>
  readonly appConflicts: ReadonlyArray<string>
  readonly appsReloading: boolean
}

export interface Location {
  readonly offer: (snapshot: Snapshot) => Effect.Effect<void>
  readonly observation: Effect.Effect<Observation>
}
