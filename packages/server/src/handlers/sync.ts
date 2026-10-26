import { CurrentHost } from "@ren/host-api/ren-host-api"
import { SyncApi } from "@ren/host-api/sync-api"
import { Brains } from "@ren/core/brains"
import { ChannelTurns } from "@ren/core/channel-turns"
import { SessionSync } from "@ren/core/session-sync"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const SyncHandler = HttpApiBuilder.group(SyncApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const sync = yield* SessionSync.Service
    const brains = yield* Brains.Service
    const turns = yield* ChannelTurns.Service
    return handlers
      .handle("sync.checkpoints", () =>
        Effect.gen(function* () {
          return { sessions: yield* sync.checkpoints(yield* CurrentHost) }
        }),
      )
      .handle("sync.startUpload", (request) =>
        Effect.gen(function* () {
          return { upload: yield* sync.startUpload(yield* CurrentHost, request.params.id, request.payload) }
        }),
      )
      .handle("sync.uploadMessages", (request) =>
        Effect.gen(function* () {
          yield* sync.uploadMessages(
            yield* CurrentHost,
            request.params.id,
            request.params.upload,
            request.payload.messages,
          )
        }),
      )
      .handle("sync.commit", (request) =>
        Effect.gen(function* () {
          yield* sync.commit(yield* CurrentHost, request.params.id, request.params.upload, request.payload)
          yield* turns.synced(request.params.id)
        }),
      )
      .handle("sync.restore", (request) =>
        Effect.gen(function* () {
          const host = yield* CurrentHost
          return {
            chats: yield* sync.restore(host, request.payload.sessionId, (chat) => brains.directoryOf(host, chat)),
          }
        }),
      )
      .handle("sync.messages", (request) =>
        Effect.gen(function* () {
          const query = request.query
          return yield* sync.messages(yield* CurrentHost, request.params.id, {
            limit: query.limit,
            ...("afterSeq" in query && "afterId" in query && { after: { seq: query.afterSeq, id: query.afterId } }),
          })
        }),
      )
  }),
)
