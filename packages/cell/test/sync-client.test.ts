import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Session } from "@ren/schema/session"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { SyncClient } from "../src/sync-client.js"

const it = testEffect(Layer.empty)

const serve = (body: unknown) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(body) })),
    (server) => Effect.promise(() => server.stop(true)),
  )

it.live("a restore reply that this brain cannot read fails as incompatible, and Ren down as unavailable", () =>
  Effect.gen(function* () {
    const changed = yield* serve({ chats: [{ id: "not a chat" }] })
    const remoteOf = (url: string) => SyncClient.make(url, Effect.succeed("token"))
    const unreadable = yield* (yield* remoteOf(changed.url.origin)).restore(Session.ID.create()).pipe(Effect.flip)
    const down = yield* (yield* remoteOf("http://127.0.0.1:9")).restore(Session.ID.create()).pipe(Effect.flip)
    expect([unreadable.isIncompatible, down.isIncompatible]).toEqual([true, undefined])
  }).pipe(Effect.provide(FetchHttpClient.layer)),
)
