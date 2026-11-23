export * as TestModelGateway from "./model-gateway.js"

import { expect, test } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { DateTime, Duration, Effect, PubSub, Redacted, Ref, Stream } from "effect"
import { ModelGateway } from "../../src/model-gateway.js"

export const provider = (id: string, fields: Partial<ModelGateway.Provider> = {}): ModelGateway.Provider => ({
  id,
  name: id,
  mark: id,
  payer: "ren",
  protocol: "openai-chat",
  auth: [{ _tag: "operator" }],
  models: "shared",
  ...fields,
})

export const model = (id: string) => ({ id, type: "chat" as const, protocol: "openai-chat" as const })

// oxlint-disable-next-line ren/no-comments -- A gateway that Ren's tests drive: its providers, each provider's models per organization, the organizations that have a provider on, and the keys it mints, counted. `grant` follows the contract: one key per brain until the key nears expiry.
export const make = Effect.fnUntraced(function* (options: {
  readonly id?: string
  readonly providers: ReadonlyArray<ModelGateway.Provider>
  readonly keyLifetime?: Duration.Duration
  readonly fixed?: boolean
}) {
  const changes = yield* PubSub.unbounded<ModelGateway.Changed>()
  const lists = yield* Ref.make(new Map<string, ModelGateway.Listed>())
  const minted = yield* Ref.make(new Map<string, { readonly key: string; readonly expiresAt: DateTime.Utc }>())
  const calls = yield* Ref.make({ models: 0, grants: 0 })
  const enabled = yield* Ref.make(new Map<string, ReadonlyArray<Auth.OrganizationID>>())
  const settings = yield* Ref.make(new Map<string, Readonly<Record<string, ModelGateway.ProviderSettings>>>())
  const keys = yield* Ref.make(new Map<string, string>())
  const limits = yield* Ref.make(new Map<string, ReadonlyArray<ModelGateway.Limit>>())
  const keyAt = (providerId: string, organizationId: string) => `${providerId}\u0000${organizationId}`
  const change = (
    providerId: string,
    organizationId: string,
    next: (current: ModelGateway.ProviderSettings) => ModelGateway.ProviderSettings,
  ) =>
    Ref.update(settings, (all) => {
      const providers = all.get(organizationId) ?? {}
      return new Map(all).set(organizationId, {
        ...providers,
        [providerId]: next(providers[providerId] ?? { enabled: true, method: "key", off: [] }),
      })
    })
  const lifetime = options.keyLifetime ?? Duration.hours(6)
  const listOf = (providerId: string, organizationId?: string) => `${providerId}\u0000${organizationId ?? ""}`

  const gateway: ModelGateway.Gateway = {
    id: options.id ?? "test",
    baseUrl: "https://models.test/v1",
    headers: {},
    providers: Effect.succeed(options.providers),
    models: (providerId, organizationId) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (found) => ({ ...found, models: found.models + 1 }))
        const all = yield* Ref.get(lists)
        const listed = all.get(listOf(providerId, organizationId)) ??
          all.get(listOf(providerId)) ?? { revision: "0", models: [] }
        return listed
      }),
    changed: Stream.fromPubSub(changes),
    organizations: (providerId) => Effect.map(Ref.get(enabled), (all) => all.get(providerId) ?? []),
    grant: (input) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (found) => ({ ...found, grants: found.grants + 1 }))
        if (options.fixed) return { _tag: "Fixed" as const, key: Redacted.make("fixed-key") }
        const now = yield* DateTime.now
        const kept = (yield* Ref.get(minted)).get(input.brainId)
        if (kept && DateTime.isGreaterThan(kept.expiresAt, DateTime.addDuration(now, Duration.hours(1))))
          return { _tag: "Minted" as const, key: Redacted.make(kept.key), expiresAt: kept.expiresAt }
        const fresh = {
          key: `key-${input.brainId}-${(yield* Ref.get(calls)).grants}`,
          expiresAt: DateTime.addDuration(now, lifetime),
        }
        yield* Ref.update(minted, (all) => new Map(all).set(input.brainId, fresh))
        return { _tag: "Minted" as const, key: Redacted.make(fresh.key), expiresAt: fresh.expiresAt }
      }),
    // oxlint-disable-next-line ren/no-comments -- The gateway is the only store of the settings (Providers P29).
    settings: (organizationId) => Effect.map(Ref.get(settings), (all) => all.get(organizationId) ?? {}),
    configure: (providerId, organizationId, next) =>
      change(providerId, organizationId, (current) => ({ ...next, ...(current.key && { key: current.key }) })),
    // oxlint-disable-next-line ren/no-comments -- The vendor takes the key `good-…`; any other key gets the vendor's message.
    test: (_, __, fields) =>
      Effect.succeed(
        Object.values(fields).some((value) => Redacted.value(value).startsWith("good"))
          ? { ok: true }
          : { ok: false, message: "Invalid API Key" },
      ),
    connect: (providerId, organizationId, fields, savedBy) =>
      Effect.gen(function* () {
        const key = Object.values(fields)
          .map(Redacted.value)
          .find((value) => value.startsWith("good"))
        if (!key) return yield* new ModelGateway.Rejected({ message: "Invalid API Key" })
        const saved = { last4: key.slice(-4), testedAt: yield* DateTime.now }
        yield* Ref.update(keys, (all) => new Map(all).set(keyAt(providerId, organizationId), key))
        yield* change(providerId, organizationId, (current) => ({ ...current, key: { ...saved, savedBy } }))
        return saved
      }),
    disconnect: (providerId, organizationId) =>
      Effect.gen(function* () {
        yield* Ref.update(keys, (all) => {
          const next = new Map(all)
          next.delete(keyAt(providerId, organizationId))
          return next
        })
        yield* change(providerId, organizationId, (current) => ({
          enabled: current.enabled,
          ...(current.method && { method: current.method }),
          off: current.off,
        }))
      }),
    // oxlint-disable-next-line ren/no-comments -- As the gateway answers: the free cap only for a free model, a seat's windows only for the seat asked for.
    limits: (providerId, organizationId, query) =>
      Effect.gen(function* () {
        const listed = yield* gateway.models(providerId, organizationId)
        const free = listed.models.some((model) => (model.gateway ?? model.id) === query.model && model.free)
        return ((yield* Ref.get(limits)).get(providerId) ?? []).filter((limit) =>
          limit._tag === "free" ? free : limit.id === query.seat,
        )
      }),
  }

  return {
    gateway,
    calls: Ref.get(calls),
    keyOf: (providerId: string, organizationId: Auth.OrganizationID) =>
      Effect.map(Ref.get(keys), (all) => all.get(keyAt(providerId, organizationId))),
    // oxlint-disable-next-line ren/no-comments -- Sets a provider's models (for one organization, or for all) and says so on `changed`, as a gateway does.
    setModels: (providerId: string, listed: ModelGateway.Listed, organizationId?: Auth.OrganizationID) =>
      Effect.gen(function* () {
        yield* Ref.update(lists, (all) => new Map(all).set(listOf(providerId, organizationId), listed))
        yield* PubSub.publish(changes, { provider: providerId, ...(organizationId && { organizationId }) })
      }),
    setOrganizations: (providerId: string, organizationIds: ReadonlyArray<Auth.OrganizationID>) =>
      Ref.update(enabled, (all) => new Map(all).set(providerId, organizationIds)),
    setLimits: (providerId: string, found: ReadonlyArray<ModelGateway.Limit>) =>
      Ref.update(limits, (all) => new Map(all).set(providerId, found)),
  }
})

const brain = (organizationId: string): ModelGateway.GrantInput => ({
  brainId: Brain.ID.create(),
  organizationId: Auth.OrganizationID.make(organizationId),
  spaceId: Space.ID.create(),
})

// oxlint-disable-next-line ren/no-comments -- Providers §6.1: the rules every gateway's `grant` keeps. `make` builds the gateway; calling it again stands for a Ren core restart over the same service.
export const contract = <E, R>(
  name: string,
  options: {
    readonly make: Effect.Effect<ModelGateway.Gateway, E, R>
    readonly run: <A>(effect: Effect.Effect<A, E | ModelGateway.Unavailable, R>) => Promise<A>
    readonly organizationId: string
  },
) => {
  const keyOf = (grant: ModelGateway.Grant) => Redacted.value(grant.key)

  test(`${name}: grant gives one brain the same key twice`, () =>
    options.run(
      Effect.gen(function* () {
        const gateway = yield* options.make
        const input = brain(options.organizationId)
        expect(keyOf(yield* gateway.grant(input))).toBe(keyOf(yield* gateway.grant(input)))
      }),
    ))

  test(`${name}: grant gives the same key after Ren core restarts`, () =>
    options.run(
      Effect.gen(function* () {
        const input = brain(options.organizationId)
        const before = yield* (yield* options.make).grant(input)
        const after = yield* (yield* options.make).grant(input)
        expect(keyOf(after)).toBe(keyOf(before))
      }),
    ))

  test(`${name}: a minted key is one brain's and expires later`, () =>
    options.run(
      Effect.gen(function* () {
        const gateway = yield* options.make
        const first = yield* gateway.grant(brain(options.organizationId))
        const second = yield* gateway.grant(brain(options.organizationId))
        if (first._tag !== "Minted" || second._tag !== "Minted") return
        expect(keyOf(first)).not.toBe(keyOf(second))
        expect(DateTime.isGreaterThan(first.expiresAt, yield* DateTime.now)).toBe(true)
      }),
    ))
}
