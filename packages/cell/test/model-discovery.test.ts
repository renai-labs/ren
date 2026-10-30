import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Context, Deferred, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { Inference } from "../src/inference.js"
import { ModelDiscovery } from "../src/model-discovery.js"
import { ModelsTest } from "./lib/models.js"

const it = testEffect(Layer.empty)

it.live(
  "a search failure preserves its snapshot while model discovery publishes; an empty success removes search",
  () =>
    Effect.gen(function* () {
      const storage = new Map<string, string>()
      const inference = Context.get(
        yield* Layer.build(Inference.layer.pipe(Layer.provide(ModelsTest.storage(storage)))),
        Inference.Service,
      )
      const state = { fail: false, empty: false, model: "first" }
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: (request) => {
              if (new URL(request.url).pathname === "/v1/search/tools")
                return state.fail
                  ? new Response("unavailable", { status: 503 })
                  : Response.json({ data: state.empty ? [] : [{ search_tool_name: "ren/search" }] })
              return Response.json({
                data: [
                  {
                    model_name: `ren/${state.model}`,
                    model_info: { model_key: state.model, provider_key: "ren", mode: "image_generation" },
                  },
                ],
              })
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      yield* inference.saveBaseUrl(Option.some(server.url.origin))
      const discovery = yield* ModelDiscovery.make({
        inference,
        keyFor: () => Effect.succeed(Option.some({ key: Redacted.make("key") })),
        apply: () => Effect.void,
      }).pipe(Effect.provide(FetchHttpClient.layer))
      yield* discovery.refresh
      const search = (yield* inference.modelCatalogs).search
      expect(search?.models).toEqual([{ id: "ren/search", upstreamId: "ren/search" }])
      state.fail = true
      state.model = "second"
      yield* discovery.refresh
      expect((yield* inference.modelCatalogs).search).toEqual(search)
      expect((yield* inference.modelCatalogs).image_generation?.models.at(0)?.id).toBe("ren/second")
      state.fail = false
      state.empty = true
      yield* discovery.refresh
      expect((yield* inference.modelCatalogs).search?.models).toEqual([])
      const reopened = Context.get(
        yield* Layer.build(Inference.layer.pipe(Layer.provide(ModelsTest.storage(storage)))),
        Inference.Service,
      )
      expect(yield* reopened.modelCatalogs).toEqual(yield* inference.modelCatalogs)
    }),
)

it.live("model discovery publishes while search is pending, and a replaced source rejects an old snapshot", () =>
  Effect.gen(function* () {
    const inference = Context.get(
      yield* Layer.build(Inference.layer.pipe(Layer.provide(ModelsTest.storage()))),
      Inference.Service,
    )
    const requested = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const published = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: (request) => {
            if (new URL(request.url).pathname !== "/v1/search/tools") return Response.json({ data: [] })
            return Effect.runPromise(
              Effect.gen(function* () {
                yield* Deferred.succeed(requested, undefined)
                yield* Deferred.await(release)
                return Response.json({ data: [{ search_tool_name: "old/search" }] })
              }),
            )
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    yield* inference.saveBaseUrl(Option.some(server.url.origin))
    yield* ModelDiscovery.make({
      inference,
      keyFor: () => Effect.succeed(Option.some({ key: Redacted.make("key") })),
      apply: () => Effect.asVoid(Deferred.succeed(published, undefined)),
    }).pipe(Effect.provide(FetchHttpClient.layer))
    yield* Deferred.await(requested)
    yield* Deferred.await(published)
    expect(Option.isSome(yield* inference.catalog)).toBe(true)
    yield* inference.saveBaseUrl(Option.some("https://new.example"))
    yield* inference.saveModelCatalogs({ search: { providerId: "ren", models: [{ id: "new/search" }] } })
    expect(
      yield* inference.saveModelCatalogs(
        { search: { providerId: "ren", models: [{ id: "old/search" }] } },
        { baseUrl: server.url.origin },
      ),
    ).toBe(false)
    expect((yield* inference.modelCatalogs).search?.models).toEqual([{ id: "new/search" }])
    yield* Deferred.succeed(release, undefined)
  }),
)
