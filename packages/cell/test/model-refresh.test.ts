import { expect, test } from "bun:test"
import { ForbiddenError, ModelsUnavailableError } from "@ren/brain-api/errors"
import { testEffect } from "@ren/executor/testing"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Context, DateTime, Effect, Fiber, Layer, Option, Redacted, Schema, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { ModelRefresh } from "../src/model-refresh.js"
import { HostToken } from "../src/host-token.js"
import { ModelStore } from "../src/model-store.js"
import { ModelsTest } from "./lib/models.js"
import { FakeRen } from "./lib/ren.js"
import { Shared } from "./lib/shared.js"
import { TestToken } from "./lib/token.js"

const it = testEffect(Layer.empty)

const expiring = 60_000

const renewed = 3_600_000

const grant = (apiKeys: Readonly<Record<string, Models.ApiKey>>) => Shared.access(apiKeys, "http://127.0.0.1:9")

const forbidden = () =>
  Response.json(Schema.encodeSync(ForbiddenError)(new ForbiddenError({ message: "The host token was revoked" })), {
    status: 403,
  })

const unavailable = () =>
  Response.json(
    Schema.encodeSync(ModelsUnavailableError)(new ModelsUnavailableError({ message: "Ren is unavailable" })),
    { status: 503 },
  )

const key = (apiKey: Option.Option<Models.ApiKey>) => Option.map(apiKey, (found) => Redacted.value(found.key))

const keys = (access: Option.Option<Models.Access>) =>
  Option.map(access, (found) =>
    found.endpoints.map((endpoint) => ({
      id: endpoint.id,
      key: Redacted.value(endpoint.apiKey.key),
      expiresAt: endpoint.apiKey.expiresAt && DateTime.toEpochMillis(endpoint.apiKey.expiresAt),
    })),
  )

const make = Effect.gen(function* () {
  const issuer = yield* ModelsTest.issuer
  const services = yield* Layer.build(
    ModelRefresh.layer(issuer.url).pipe(
      Layer.provideMerge(HostToken.layer(issuer.url, TestToken.keys)),
      Layer.provideMerge(ModelsTest.storage()),
    ),
  )
  return {
    ...issuer,
    store: Context.get(services, ModelStore.Service),
    refresh: Context.get(services, ModelRefresh.Service),
    hostToken: Context.get(services, HostToken.Service),
  }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(TestClock.layer()), Effect.runPromise)

const todo = <A, E>(name: string, body: Effect.Effect<A, E, Scope.Scope>) => test.todo(name, () => run(body))

it.effect("a delayed forbidden refresh cannot remove a newer host token", () =>
  Effect.gen(function* () {
    const subject = yield* make
    yield* subject.store.write(grant({ stub: Shared.apiKey("old-key", expiring) }), "old-host")
    const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
    const exchange = yield* subject.next
    expect(exchange.authorization).toBe("Bearer old-host")
    const newer = grant({ stub: Shared.apiKey("new-key", renewed) })
    yield* subject.store.write(newer, "new-host")
    yield* subject.reply(exchange, forbidden())
    expect(yield* Fiber.join(pending)).toEqual(Option.none())
    expect(yield* subject.store.readHostToken).toEqual(Option.some("new-host"))
    expect(keys(yield* subject.store.read)).toEqual(keys(Option.some(newer)))
  }),
)

it.effect("a forbidden refresh removes the host token that made it, and later refreshes send no request", () =>
  Effect.gen(function* () {
    const subject = yield* make
    const access = grant({ stub: Shared.apiKey("old-key", expiring) })
    yield* subject.store.write(access, "old-host")
    const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
    yield* subject.reply(yield* subject.next, forbidden())
    expect(yield* Fiber.join(pending)).toEqual(Option.none())
    expect(yield* subject.store.readHostToken).toEqual(Option.none())
    expect(keys(yield* subject.store.read)).toEqual(keys(Option.some(access)))
    expect(yield* Effect.all([subject.refresh("stub"), subject.refresh("stub")])).toEqual([
      Option.none(),
      Option.none(),
    ])
    expect(subject.requests).toEqual(["Bearer old-host"])
  }),
)

const newer = grant({ stub: Shared.apiKey("new-key", renewed) })

test.each<
  [string, (store: ModelStore.Interface) => Effect.Effect<void>, Option.Option<string>, Option.Option<Models.Access>]
>([
  ["access removed", (store) => store.remove, Option.none(), Option.none()],
  [
    "access and a host token installed",
    (store) => store.write(newer, "new-host"),
    Option.some("new-host"),
    Option.some(newer),
  ],
])("a successful refresh cannot overwrite %s while its response was in flight", (_name, change, hostToken, access) =>
  run(
    Effect.gen(function* () {
      const subject = yield* make
      yield* subject.store.write(grant({ stub: Shared.apiKey("old-key", expiring) }), "old-host")
      const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
      const exchange = yield* subject.next
      yield* change(subject.store)
      yield* subject.reply(
        exchange,
        ModelsTest.granted({
          access: grant({ stub: Shared.apiKey("late-key", 2 * renewed) }),
          hostToken: Redacted.make("late-host"),
        }),
      )
      expect(key(yield* Fiber.join(pending))).not.toEqual(Option.some("late-key"))
      expect(yield* subject.store.readHostToken).toEqual(hostToken)
      expect(keys(yield* subject.store.read)).toEqual(keys(access))
    }),
  ),
)

todo(
  "REN-1486 a successful refresh cannot restore an endpoint removed under the same host token while it was in flight",
  Effect.gen(function* () {
    const subject = yield* make
    yield* subject.store.write(
      grant({ stub: Shared.apiKey("stub-old", expiring), anthropic: Shared.apiKey("anthropic-old", expiring) }),
      "host",
    )
    const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
    const exchange = yield* subject.next
    yield* subject.store.write(grant({ stub: Shared.apiKey("stub-old", expiring) }), "host")
    yield* subject.reply(
      exchange,
      ModelsTest.granted({
        access: grant({ stub: Shared.apiKey("stub-new", renewed), anthropic: Shared.apiKey("anthropic-new", renewed) }),
        hostToken: Redacted.make("host"),
      }),
    )
    yield* Fiber.join(pending)
    expect(
      Option.map(keys(yield* subject.store.read), (endpoints) => endpoints.map((endpoint) => endpoint.id)),
    ).toEqual(Option.some(["stub"]))
  }),
)

it.effect("concurrent refreshes of one or two expiring endpoints are served by one renewal", () =>
  Effect.gen(function* () {
    const subject = yield* make
    yield* subject.store.write(
      grant({ stub: Shared.apiKey("stub-old", expiring), anthropic: Shared.apiKey("anthropic-old", expiring) }),
      "old-host",
    )
    const pending = yield* Effect.all(
      [subject.refresh("stub"), subject.refresh("stub"), subject.refresh("anthropic")],
      { concurrency: "unbounded" },
    ).pipe(Effect.forkChild)
    yield* subject.reply(
      yield* subject.next,
      ModelsTest.granted({
        access: grant({ stub: Shared.apiKey("stub-new", renewed), anthropic: Shared.apiKey("anthropic-new", renewed) }),
        hostToken: Redacted.make("new-host"),
      }),
    )
    expect((yield* Fiber.join(pending)).map(key)).toEqual([
      Option.some("stub-new"),
      Option.some("stub-new"),
      Option.some("anthropic-new"),
    ])
    expect(subject.requests).toEqual(["Bearer old-host"])
    expect(yield* subject.store.readHostToken).toEqual(Option.some("new-host"))
  }),
)

it.effect(
  "a model refresh on a Ren that never answers ends in 10 seconds and does not block the host token renewal",
  () =>
    Effect.gen(function* () {
      const subject = yield* make
      yield* TestClock.setTime(Date.now())
      const sessionId = Session.ID.create()
      const access = grant({ stub: Shared.apiKey("old-key", expiring) })
      yield* subject.store.write(access, yield* Effect.promise(() => FakeRen.hostToken(sessionId)))
      const refreshing = yield* subject.refresh("stub").pipe(Effect.forkChild)
      yield* subject.next
      const soon = yield* Effect.promise(() => FakeRen.hostToken(sessionId, 60))
      yield* subject.store.write(access, soon)
      const renewing = yield* subject.hostToken.current.pipe(Effect.forkChild)
      const exchange = yield* subject.next
      expect(exchange.authorization).toBe(`Bearer ${soon}`)
      const renewed = yield* Effect.promise(() => FakeRen.hostToken(sessionId))
      yield* subject.reply(exchange, Response.json({ hostToken: renewed }))
      expect(yield* Fiber.join(renewing)).toEqual(Option.some(renewed))
      expect(refreshing.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust(HostToken.renAnswersWithin)
      expect(yield* Fiber.join(refreshing)).toEqual(Option.none())
      expect(keys(yield* subject.store.read)).toEqual(keys(Option.some(access)))
    }),
)

it.effect("a renewal that omits the requested endpoint removes it and returns no key", () =>
  Effect.gen(function* () {
    const subject = yield* make
    yield* subject.store.write(
      grant({ stub: Shared.apiKey("stub-old", expiring), anthropic: Shared.apiKey("anthropic-old", expiring) }),
      "old-host",
    )
    const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
    const remaining = grant({ anthropic: Shared.apiKey("anthropic-new", renewed) })
    yield* subject.reply(
      yield* subject.next,
      ModelsTest.granted({ access: remaining, hostToken: Redacted.make("new-host") }),
    )
    expect(yield* Fiber.join(pending)).toEqual(Option.none())
    expect(keys(yield* subject.store.read)).toEqual(keys(Option.some(remaining)))
    expect(yield* subject.store.readHostToken).toEqual(Option.some("new-host"))
  }),
)

it.effect("a renewed key that expires earlier is the issuer's answer: it is stored and returned", () =>
  Effect.gen(function* () {
    const subject = yield* make
    yield* subject.store.write(grant({ stub: Shared.apiKey("old-key", expiring) }), "old-host")
    const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
    const earlier = grant({ stub: Shared.apiKey("renewed-key", expiring - 30_000) })
    yield* subject.reply(
      yield* subject.next,
      ModelsTest.granted({ access: earlier, hostToken: Redacted.make("new-host") }),
    )
    expect(key(yield* Fiber.join(pending))).toEqual(Option.some("renewed-key"))
    expect(keys(yield* subject.store.read)).toEqual(keys(Option.some(earlier)))
  }),
)

it.effect("a stored key that never expires is served without a renewal request", () =>
  Effect.gen(function* () {
    const subject = yield* make
    yield* subject.store.write(grant({ stub: Shared.apiKey("forever") }), "host")
    expect(
      yield* Effect.raceFirst(
        subject.refresh("stub").pipe(Effect.map(key)),
        subject.next.pipe(Effect.as("a renewal request")),
      ),
    ).toEqual(Option.some("forever"))
  }),
)

it.effect("a key expiring one millisecond after the five-minute window is served without a renewal request", () =>
  Effect.gen(function* () {
    const subject = yield* make
    yield* TestClock.setTime(1_000_000)
    yield* subject.store.write(grant({ stub: Shared.apiKey("current", 1_300_001) }), "host")
    expect(key(yield* subject.refresh("stub"))).toEqual(Option.some("current"))
    expect(subject.requests).toEqual([])
  }),
)

it.effect("a key expiring exactly at the five-minute window is renewed before it is served", () =>
  Effect.gen(function* () {
    const subject = yield* make
    yield* TestClock.setTime(1_000_000)
    yield* subject.store.write(grant({ stub: Shared.apiKey("current", 1_300_000) }), "host")
    const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
    yield* subject.reply(
      yield* subject.next,
      ModelsTest.granted({
        access: grant({ stub: Shared.apiKey("renewed", 4_600_000) }),
        hostToken: Redacted.make("next-host"),
      }),
    )
    expect(key(yield* Fiber.join(pending))).toEqual(Option.some("renewed"))
    expect(subject.requests).toEqual(["Bearer host"])
  }),
)

it.effect("an unavailable renewal keeps the stored key and host token, and the next call renews", () =>
  Effect.gen(function* () {
    const subject = yield* make
    const access = grant({ stub: Shared.apiKey("old-key", expiring) })
    yield* subject.store.write(access, "old-host")
    const failed = yield* subject.refresh("stub").pipe(Effect.forkChild)
    yield* subject.reply(yield* subject.next, unavailable())
    expect(yield* Fiber.join(failed)).toEqual(Option.none())
    expect(keys(yield* subject.store.read)).toEqual(keys(Option.some(access)))
    expect(yield* subject.store.readHostToken).toEqual(Option.some("old-host"))
    const pending = yield* subject.refresh("stub").pipe(Effect.forkChild)
    yield* subject.reply(
      yield* subject.next,
      ModelsTest.granted({
        access: grant({ stub: Shared.apiKey("new-key", renewed) }),
        hostToken: Redacted.make("new-host"),
      }),
    )
    expect(key(yield* Fiber.join(pending))).toEqual(Option.some("new-key"))
    expect(subject.requests).toEqual(["Bearer old-host", "Bearer old-host"])
  }),
)
