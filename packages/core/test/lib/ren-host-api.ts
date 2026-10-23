export * as RenHostApiTest from "./ren-host-api.js"

import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { SyncApi } from "@ren/host-api/sync-api"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Brains } from "../../src/brains.js"
import { SessionSync } from "../../src/session-sync.js"

export type Around = <A, E, R>(endpoint: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

const handlers = (around: Around) =>
  Layer.mergeAll(
    HttpApiBuilder.group(RenHostApi, "models", (group) =>
      Effect.map(Brains.Service, (brain) =>
        group.handle("models.refresh", () =>
          around("models.refresh", Effect.flatMap(CurrentHost, brain.refreshModels)),
        ),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "environments", (group) =>
      Effect.map(Brains.Service, (brain) =>
        group
          .handle("environments.access", (request) =>
            around(
              "environments.access",
              Effect.flatMap(CurrentHost, (host) => brain.accessEnvironment(host, request.params.id)),
            ),
          )
          .handle("environments.release", (request) =>
            around(
              "environments.release",
              Effect.flatMap(CurrentHost, (host) => brain.releaseEnvironment(host, request.params.id)),
            ),
          ),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "host", (group) =>
      Effect.map(Brains.Service, (brain) =>
        group.handle("host.refresh", () => around("host.refresh", Effect.flatMap(CurrentHost, brain.refreshHostToken))),
      ),
    ),
    HttpApiBuilder.group(RenHostApi, "pull", (group) =>
      Effect.map(Brains.Service, (brain) =>
        group.handle("pull", (request) =>
          around(
            "pull",
            Effect.flatMap(CurrentHost, (host) => brain.pull(host, request.payload)),
          ),
        ),
      ),
    ),
  )

const forgetful = HttpApiBuilder.group(SyncApi, "sync", (group) =>
  Effect.succeed(
    group
      .handle("sync.checkpoints", () => Effect.succeed({ sessions: [] }))
      .handle("sync.startUpload", () => Effect.succeed({ upload: 1 }))
      .handle("sync.uploadMessages", () => Effect.void)
      .handle("sync.commit", () => Effect.void)
      .handle("sync.restore", () => Effect.succeed({ chats: [] }))
      .handle("sync.messages", () => Effect.succeed({ messages: [], next: null })),
  ),
)

// oxlint-disable-next-line ren/no-comments -- Sync into Postgres, as the server's sync handler does, for tests that restore chats.
const remembering = HttpApiBuilder.group(SyncApi, "sync", (group) =>
  Effect.map(SessionSync.Service, (sync) =>
    group
      .handle("sync.checkpoints", () =>
        Effect.map(Effect.flatMap(CurrentHost, sync.checkpoints), (sessions) => ({ sessions })),
      )
      .handle("sync.startUpload", (request) =>
        Effect.flatMap(CurrentHost, (host) => sync.startUpload(host, request.params.id, request.payload)).pipe(
          Effect.map((upload) => ({ upload })),
        ),
      )
      .handle("sync.uploadMessages", (request) =>
        Effect.flatMap(CurrentHost, (host) =>
          sync.uploadMessages(host, request.params.id, request.params.upload, request.payload.messages),
        ),
      )
      .handle("sync.commit", (request) =>
        Effect.flatMap(CurrentHost, (host) =>
          sync.commit(host, request.params.id, request.params.upload, request.payload),
        ),
      )
      .handle("sync.restore", (request) =>
        Effect.flatMap(CurrentHost, (host) => sync.restore(host, request.payload.sessionId)).pipe(
          Effect.map((chats) => ({ chats })),
        ),
      )
      .handle("sync.messages", (request) =>
        Effect.flatMap(CurrentHost, (host) =>
          sync.messages(host, request.params.id, {
            limit: request.query.limit,
            ...("afterSeq" in request.query &&
              "afterId" in request.query && { after: { seq: request.query.afterSeq, id: request.query.afterId } }),
          }),
        ),
      ),
  ),
)

export const layer = (around: Around = (_endpoint, effect) => effect) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(RenHostApi).pipe(Layer.provide(handlers(around))),
    HttpApiBuilder.layer(SyncApi).pipe(Layer.provide(forgetful)),
  ).pipe(Layer.provide(Brains.hostAuthentication))

export const layerSynced = (around: Around = (_endpoint, effect) => effect) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(RenHostApi).pipe(Layer.provide(handlers(around))),
    HttpApiBuilder.layer(SyncApi).pipe(Layer.provide(remembering), Layer.provide(SessionSync.layer)),
  ).pipe(Layer.provide(Brains.hostAuthentication))
