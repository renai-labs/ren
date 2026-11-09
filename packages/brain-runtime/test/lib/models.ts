export * as ModelsTest from "./models.js"

import { Brain } from "@ren/schema/brain"
import { Deferred, Effect, Layer, Queue, Schema } from "effect"
import { BrainStorage } from "../../src/brain-storage.js"
import { ModelStore } from "../../src/model-store.js"

export interface Exchange {
  readonly authorization: string | null
  readonly response: Deferred.Deferred<Response>
}

export const storage = (stored = new Map<string, string>()) =>
  ModelStore.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(
        BrainStorage.Service,
        BrainStorage.Service.of({
          get: (key) => Promise.resolve(stored.get(key)),
          put: (key, value) => Promise.resolve(void stored.set(key, value)),
          delete: (key) => Promise.resolve(stored.delete(key)),
        }),
      ),
    ),
  )

export const granted = (body: Brain.ModelGrant) =>
  Response.json(Schema.encodeSync(Schema.toCodecJson(Brain.ModelGrant))(body))

export const issuer = Effect.gen(function* () {
  const exchanges = yield* Queue.unbounded<Exchange>()
  const requests: Array<string | null> = []
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) => {
          const response = Deferred.makeUnsafe<Response>()
          requests.push(request.headers.get("authorization"))
          Queue.offerUnsafe(exchanges, { authorization: request.headers.get("authorization"), response })
          return Effect.runPromise(Deferred.await(response))
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  return {
    url: server.url.origin,
    requests,
    next: Queue.take(exchanges),
    reply: (exchange: Exchange, response: Response) => Deferred.succeed(exchange.response, response),
  }
})
