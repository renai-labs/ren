export * as RenHostApiTest from "./ren-host-api.js"

import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { SyncApi } from "@ren/host-api/sync-api"
import { TestSettings } from "@ren/cell/testing"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { BrainHost } from "../../src/brain-host.js"

export type Around = <A, E, R>(endpoint: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

const handlers = (around: Around) =>
  Layer.mergeAll(
    HttpApiBuilder.group(RenHostApi, "models", (group) =>
      Effect.map(BrainHost.Service, (brain) =>
        group.handle("models.refresh", () =>
          around("models.refresh", Effect.flatMap(CurrentHost, brain.refreshModels)),
        ),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "environments", (group) =>
      Effect.map(BrainHost.Service, (brain) =>
        group
          .handle("environments.access", () =>
            around("environments.access", Effect.flatMap(CurrentHost, brain.accessEnvironment)),
          )
          .handle("environments.release", () =>
            around("environments.release", Effect.flatMap(CurrentHost, brain.releaseEnvironment)),
          ),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "host", (group) =>
      Effect.map(BrainHost.Service, (brain) =>
        group.handle("host.refresh", () => around("host.refresh", Effect.flatMap(CurrentHost, brain.refreshHostToken))),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "settings", (group) =>
      Effect.succeed(group.handle("settings.read", () => Effect.succeed(TestSettings.layers()))),
    ),
  )

const forgetful = HttpApiBuilder.group(SyncApi, "sync", (group) =>
  Effect.succeed(
    group
      .handle("sync.checkpoints", () => Effect.succeed({ sessions: [] }))
      .handle("sync.startUpload", () => Effect.succeed({ upload: 1 }))
      .handle("sync.uploadMessages", () => Effect.void)
      .handle("sync.commit", () => Effect.void)
      .handle("sync.restore", () => Effect.succeed({ sessions: [] }))
      .handle("sync.messages", () => Effect.succeed({ messages: [], next: null })),
  ),
)

export const layer = (around: Around = (_endpoint, effect) => effect) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(RenHostApi).pipe(Layer.provide(handlers(around))),
    HttpApiBuilder.layer(SyncApi).pipe(Layer.provide(forgetful)),
  ).pipe(Layer.provide(BrainHost.hostAuthentication))
