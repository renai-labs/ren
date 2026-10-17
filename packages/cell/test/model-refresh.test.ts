import { expect } from "bun:test"
import type { ModelsBody } from "@ren/brain-api/brain-api"
import { ForbiddenError, ModelsUnavailableError } from "@ren/brain-api/errors"
import { CurrentHost, HostAuthentication, ModelsApi } from "@ren/brain-api/models-api"
import { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Context, Deferred, Effect, Fiber, Layer, Option, Redacted } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { ModelRefresh } from "../src/model-refresh.js"
import { ModelStore } from "../src/model-store.js"
import { Testing } from "./lib/effect.js"
import { Shared } from "./lib/shared.js"

const it = Testing.testEffect(Layer.empty)

const hourMs = 3_600_000

interface Core {
  readonly authorize: (token: string) => Effect.Effect<void, ForbiddenError>
  readonly refresh: Effect.Effect<ModelsBody, ModelsUnavailableError>
}

const serve = Effect.fnUntraced(function* (core: Core) {
  const tokens: Array<string> = []
  const host = { brainId: Session.ID.create(), organizationId: Auth.OrganizationID.create() }
  const api = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(ModelsApi).pipe(
      Layer.provide(
        HttpApiBuilder.group(ModelsApi, "models", (handlers) => handlers.handle("models.refresh", () => core.refresh)),
      ),
      Layer.provide(
        Layer.succeed(
          HostAuthentication,
          HostAuthentication.of({
            bearer: (httpEffect, options) =>
              Effect.gen(function* () {
                const token = Redacted.value(options.credential)
                tokens.push(token)
                yield* core.authorize(token)
                return yield* httpEffect.pipe(Effect.provideService(CurrentHost, host))
              }),
          }),
        ),
      ),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => api.handler(request) })),
    (opened) => Effect.promise(() => opened.stop(true).then(api.dispose)),
  )
  const stored = new Map<string, string>()
  const context = yield* Layer.build(
    ModelRefresh.layer(server.url.origin).pipe(
      Layer.provideMerge(ModelStore.layer),
      Layer.provide(
        Layer.succeed(ModelStore.Storage, {
          get: (key) => Promise.resolve(stored.get(key)),
          put: (key, value) => Promise.resolve(void stored.set(key, value)),
          delete: (key) => Promise.resolve(stored.delete(key)),
        }),
      ),
    ),
  )
  return {
    tokens,
    store: Context.get(context, ModelStore.Service),
    refresh: Context.get(context, ModelRefresh.Service),
  }
})

const answer = (access: Models.Access, hostToken: string): Core => ({
  authorize: () => Effect.void,
  refresh: Effect.succeed({ access, hostToken }),
})

const endpointIds = (stored: Option.Option<Models.Access>) =>
  Option.match(stored, { onNone: () => [], onSome: (access) => access.endpoints.map((endpoint) => endpoint.id) })

const keyOf = (refreshed: Option.Option<Models.ApiKey>) => Option.map(refreshed, (apiKey) => Redacted.value(apiKey.key))

it.live("a forbidden reply to an older host token keeps the host token configured while it was in flight", () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const subject = yield* serve({
      authorize: () =>
        Deferred.succeed(arrived, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.andThen(Effect.fail(new ForbiddenError({ message: "The host token is not valid" }))),
        ),
      refresh: Effect.die(new Error("a forbidden host token never reaches the handler")),
    })
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("expiring", Date.now() + 60_000) }), "host-old")
    const refreshing = yield* subject.refresh("stub").pipe(Effect.forkChild)
    yield* Deferred.await(arrived)
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("configured", Date.now() + hourMs) }), "host-new")
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(refreshing)
    expect(yield* subject.store.readHostToken).toEqual(Option.some("host-new"))
  }),
)

it.live("a refresh answered after the models were removed writes nothing back", () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const subject = yield* serve({
      authorize: () => Effect.void,
      refresh: Deferred.succeed(arrived, undefined).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.as({ access: Shared.access({ stub: Shared.apiKey("late", Date.now() + hourMs) }), hostToken: "host-2" }),
      ),
    })
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("expiring", Date.now() + 60_000) }), "host-1")
    const refreshing = yield* subject.refresh("stub").pipe(Effect.forkChild)
    yield* Deferred.await(arrived)
    yield* subject.store.remove
    yield* Deferred.succeed(gate, undefined)
    expect(yield* Fiber.join(refreshing)).toEqual(Option.none())
    expect([Option.isNone(yield* subject.store.read), Option.isNone(yield* subject.store.readHostToken)]).toEqual([
      true,
      true,
    ])
  }),
)

it.live("a refresh answered after an endpoint was removed does not bring it back", () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const expiresAt = Date.now() + 60_000
    const subject = yield* serve({
      authorize: () => Effect.void,
      refresh: Deferred.succeed(arrived, undefined).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.as({
          access: Shared.access({
            stub: Shared.apiKey("refreshed", Date.now() + hourMs),
            later: Shared.apiKey("later"),
          }),
          hostToken: "host-2",
        }),
      ),
    })
    yield* subject.store.write(
      Shared.access({ stub: Shared.apiKey("expiring", expiresAt), later: Shared.apiKey("later") }),
      "host-1",
    )
    const refreshing = yield* subject.refresh("stub").pipe(Effect.forkChild)
    yield* Deferred.await(arrived)
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("expiring", expiresAt) }), "host-1b")
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(refreshing)
    expect(endpointIds(yield* subject.store.read)).toEqual(["stub"])
  }),
)

it.live("concurrent refreshes of one expiring key reach core once and all take the new key", () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const subject = yield* serve({
      authorize: () => Effect.void,
      refresh: Deferred.succeed(arrived, undefined).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.as({
          access: Shared.access({ stub: Shared.apiKey("fresh", Date.now() + hourMs) }),
          hostToken: "host-2",
        }),
      ),
    })
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("expiring", Date.now() + 60_000) }), "host-1")
    const refreshing = yield* Effect.all(
      Array.from({ length: 3 }, () => subject.refresh("stub")),
      { concurrency: "unbounded" },
    ).pipe(Effect.forkChild)
    yield* Deferred.await(arrived)
    yield* Deferred.succeed(gate, undefined)
    const refreshed = yield* Fiber.join(refreshing)
    expect([refreshed.map(keyOf), subject.tokens]).toEqual([
      Array.from({ length: 3 }, () => Option.some("fresh")),
      ["host-1"],
    ])
  }),
)

it.live("a key outside the refresh window is used without asking core", () =>
  Effect.gen(function* () {
    const subject = yield* serve(answer(Shared.access({ stub: Shared.apiKey("from-core") }), "host-2"))
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("stored", Date.now() + hourMs) }), "host-1")
    expect([keyOf(yield* subject.refresh("stub")), subject.tokens]).toEqual([Option.some("stored"), []])
  }),
)

it.live("a key that never expires is used without asking core", () =>
  Effect.gen(function* () {
    const subject = yield* serve(answer(Shared.access({ stub: Shared.apiKey("from-core") }), "host-2"))
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("forever") }), "host-1")
    expect([keyOf(yield* subject.refresh("stub")), subject.tokens]).toEqual([Option.some("forever"), []])
  }),
)

it.live("an unavailable core keeps the stored access and host token, and the next refresh takes the new key", () =>
  Effect.gen(function* () {
    const failures = { remaining: 1 }
    const subject = yield* serve({
      authorize: () => Effect.void,
      refresh: Effect.suspend(() => {
        if (failures.remaining-- > 0)
          return Effect.fail(new ModelsUnavailableError({ message: "Model access is unavailable" }))
        return Effect.succeed({
          access: Shared.access({ stub: Shared.apiKey("fresh", Date.now() + hourMs) }),
          hostToken: "host-2",
        })
      }),
    })
    yield* subject.store.write(Shared.access({ stub: Shared.apiKey("expiring", Date.now() + 60_000) }), "host-1")
    expect(yield* subject.refresh("stub")).toEqual(Option.none())
    const stored = Option.flatMap(yield* subject.store.read, (access) =>
      Option.fromNullishOr(access.endpoints[0]?.apiKey),
    )
    expect([keyOf(stored), yield* subject.store.readHostToken]).toEqual([
      Option.some("expiring"),
      Option.some("host-1"),
    ])
    expect([keyOf(yield* subject.refresh("stub")), yield* subject.store.readHostToken]).toEqual([
      Option.some("fresh"),
      Option.some("host-2"),
    ])
  }),
)

it.live("a forbidden current host token stops refreshes until a new configuration brings another", () =>
  Effect.gen(function* () {
    const subject = yield* serve({
      authorize: (token) =>
        token === "host-revoked"
          ? Effect.fail(new ForbiddenError({ message: "The host token is not valid" }))
          : Effect.void,
      refresh: Effect.sync(() => ({
        access: Shared.access({ stub: Shared.apiKey("fresh", Date.now() + hourMs) }),
        hostToken: "host-3",
      })),
    })
    const expiring = Shared.access({ stub: Shared.apiKey("expiring", Date.now() + 60_000) })
    yield* subject.store.write(expiring, "host-revoked")
    expect(yield* subject.refresh("stub")).toEqual(Option.none())
    expect(yield* subject.refresh("stub")).toEqual(Option.none())
    expect(subject.tokens).toEqual(["host-revoked"])
    yield* subject.store.write(expiring, "host-2")
    expect(keyOf(yield* subject.refresh("stub"))).toEqual(Option.some("fresh"))
    expect(subject.tokens).toEqual(["host-revoked", "host-2"])
  }),
)
