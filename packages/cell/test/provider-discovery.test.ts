import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Context, Deferred, Effect, Fiber, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelDiscovery } from "../src/model-discovery.js"
import { ModelsTest } from "./lib/models.js"

const it = testEffect(FetchHttpClient.layer)

it.live("brains discover providers independently with their own keys and keep only registered catalogs", () =>
  Effect.gen(function* () {
    const calls: Array<[string, string | null]> = []
    const state = { firstDown: false, second: "chat" }
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (request) => {
            const path = new URL(request.url).pathname
            calls.push([path, request.headers.get("authorization")])
            if (path.startsWith("/first/") && state.firstDown) return new Response(null, { status: 503 })
            if (path.endsWith("/search/providers")) return Response.json([])
            return Response.json({
              baseUrl: `${new URL(request.url).origin}/${path.split("/")[1]}/v1`,
              models: [
                { id: path.startsWith("/first/") ? "chat" : state.second, type: "chat", protocol: "openai-chat" },
              ],
            })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const catalog = Context.get(
      yield* Layer.build(ModelCatalog.layer.pipe(Layer.provide(ModelsTest.storage()))),
      ModelCatalog.Service,
    )
    const providers = ["first", "second"].map((id) => ({
      id,
      protocol: "openai-chat" as const,
      baseUrl: `${server.url.origin}/${id}/v1`,
      catalog: "inference" as const,
    }))
    const keyFor = (id: string) => Effect.succeed(Option.some({ key: Redacted.make(`key-${id}`) }))
    yield* catalog.register(providers)
    yield* ModelDiscovery.refresh(catalog, keyFor)
    expect(
      Option.getOrThrow(yield* catalog.current).endpoints.map((endpoint) => [endpoint.id, endpoint.models[0]?.id]),
    ).toEqual([
      ["first", "chat"],
      ["second", "chat"],
    ])
    expect(calls).toHaveLength(4)
    expect(calls.every((call) => call[1] === `Bearer key-${call[0].split("/")[1]}`)).toBe(true)
    state.firstDown = true
    state.second = "new-chat"
    yield* ModelDiscovery.refresh(catalog, keyFor)
    expect(
      Option.getOrThrow(yield* catalog.current).endpoints.map((endpoint) => [endpoint.id, endpoint.models[0]?.id]),
    ).toEqual([
      ["first", "chat"],
      ["second", "new-chat"],
    ])
    yield* catalog.register(providers.filter((provider) => provider.id === "second"))
    expect(Option.getOrThrow(yield* catalog.current).endpoints.map((endpoint) => endpoint.id)).toEqual(["second"])
  }),
)

it.live("a removed provider's in-flight discovery cannot restore its catalog", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    const catalog = Context.get(
      yield* Layer.build(ModelCatalog.layer.pipe(Layer.provide(ModelsTest.storage()))),
      ModelCatalog.Service,
    )
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (request) =>
            Effect.runPromise(
              Effect.gen(function* () {
                if (new URL(request.url).pathname.endsWith("/search/providers")) return Response.json([])
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                return Response.json({
                  baseUrl: `${new URL(request.url).origin}/v1`,
                  models: [{ id: "chat", type: "chat", protocol: "openai-chat" }],
                })
              }),
            ),
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    yield* catalog.register([
      { id: "first", protocol: "openai-chat", baseUrl: `${server.url.origin}/v1`, catalog: "inference" },
    ])
    const pending = yield* ModelDiscovery.refresh(catalog, () =>
      Effect.succeed(Option.some({ key: Redacted.make("key") })),
    ).pipe(Effect.forkScoped)
    yield* Deferred.await(started)
    yield* catalog.register([])
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(pending)
    expect(yield* catalog.current).toEqual(Option.some({ endpoints: [] }))
  }),
)
