export * as CredentialSource from "./credential-source.js"

import { BrainToken } from "@ren/host-api/brain-token"
import type { AppProfile } from "@ren/schema/app-profile"
import { Credential } from "@ren/schema/credential"
import { Workload } from "@ren/schema/workload"
import { Auth } from "@ren/schema/auth"
import {
  Cache,
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
} from "effect"
import { BrainClient } from "./brain-client.js"
import { Credentials } from "./credentials.js"
import { McpProvider } from "./mcp-provider.js"
import { Models } from "./models.js"

export type Value =
  | { readonly type: "key"; readonly value: Redacted.Redacted }
  | { readonly type: "basic"; readonly username: string; readonly password: Redacted.Redacted }
  | { readonly type: "fields"; readonly fields: Readonly<Record<string, Redacted.Redacted>> }
  | {
      readonly type: "route"
      readonly upstream: Redacted.Redacted
      readonly headers: ReadonlyArray<{ readonly name: string; readonly value: Redacted.Redacted }>
    }

// oxlint-disable-next-line ren/no-comments -- expiresAt is when the value stops working upstream; the egress never sends it after that (C37).
export interface Sourced {
  readonly value: Value
  readonly expiresAt?: DateTime.Utc
}

export class Unavailable extends Schema.TaggedError<Unavailable>()("CredentialSource.Unavailable", {
  label: Schema.String,
  message: Schema.String,
}) {}

export interface Source {
  readonly candidates: (
    scope: Credentials.Scope,
    profileIds: ReadonlyArray<AppProfile.ID>,
  ) => Effect.Effect<ReadonlyArray<Credentials.Candidate>>
  readonly value: (
    candidate: Credentials.Candidate,
    scope: Credentials.Scope,
  ) => Effect.Effect<Option.Option<Sourced>, Unavailable>
  readonly forget: (candidate: Credentials.Candidate, scope: Credentials.Scope) => Effect.Effect<void>
}

export class Static extends Context.Service<Static, Source>()("@ren/core/CredentialSource/Static") {}

export class Provider extends Context.Service<Provider, Source>()("@ren/core/CredentialSource/Provider") {}

export class Minted extends Context.Service<Minted, Source>()("@ren/core/CredentialSource/Minted") {}

export class Service extends Context.Service<Service, Source>()("@ren/core/CredentialSource") {}

// oxlint-disable-next-line ren/no-comments -- A sign-in and a client-credentials exchange inject their access token as a key. A `route` value comes from `layerProvider`; a cleared one injects nothing (connections.md §5).
const staticValue = (value: Credentials.Sealed): Option.Option<Value> => {
  if (value.type === "key" || value.type === "basic" || value.type === "fields") return Option.some(value)
  if (value.type === "oauth" || value.type === "client_credentials")
    return Option.map(Option.fromNullishOr(value.accessToken), (token): Value => ({ type: "key", value: token }))
  return Option.none()
}

// oxlint-disable-next-line ren/no-comments -- Pasted values and sign-ins: Ren opens the stored row with Envelope. A provider is another source (README §5).
export const layerStatic = Layer.effect(
  Static,
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    return Static.of({
      candidates: (scope, profileIds) => credentials.candidates(scope, profileIds),
      value: Effect.fn("CredentialSource.static")(function* (candidate: Credentials.Candidate) {
        if (!Schema.is(Credential.ID)(candidate.id)) return Option.none()
        const opened = yield* credentials.open(candidate.id)
        return Option.flatMap(opened, (found) =>
          Option.map(staticValue(found.value), (value): Sourced => ({
            value,
            ...(found.expiresAt && { expiresAt: found.expiresAt }),
          })),
        )
      }),
      forget: () => Effect.void,
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- connections.md §10 rule 7 (K25), profiles.md §14: a `route` value is what the credential's provider routes its sealed state to: an upstream URL and headers, with an optional expiry. Neither reaches the workload.
export const layerProvider = Layer.effect(
  Provider,
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    const registry = yield* McpProvider.Registry
    return Provider.of({
      candidates: () => Effect.succeed([]),
      value: Effect.fn("CredentialSource.provider")(function* (candidate: Credentials.Candidate) {
        if (!Schema.is(Credential.ID)(candidate.id)) return Option.none()
        const opened = yield* credentials.open(candidate.id)
        if (Option.isNone(opened) || opened.value.value.type !== "route") return Option.none()
        const unavailable = (message: string) => new Unavailable({ label: candidate.label, message })
        const provider = yield* Option.match(opened.value.provider, {
          onNone: () => Effect.fail(unavailable("The credential names no provider.")),
          onSome: (id) => registry.get(id).pipe(Effect.mapError((error) => unavailable(error.message))),
        })
        const route = yield* provider
          .route(opened.value.value.state)
          .pipe(Effect.mapError((error) => unavailable(error.message)))
        return Option.some({
          value: { type: "route", upstream: route.upstream, headers: route.headers },
          ...(route.expiresAt && { expiresAt: route.expiresAt }),
        } satisfies Sourced)
      }),
      forget: () => Effect.void,
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- Longer than the 15 minutes the egress uses its last answer while Ren is down, so a value it keeps has not expired (C37; ren-v1 INV-24).
const renewBefore = Duration.minutes(20)

const ttlUntil = (expiresAtMillis: number, now: number) =>
  Duration.millis(Math.max(0, expiresAtMillis - Duration.toMillis(renewBefore) - now))

const ren = "REN"
const models = "MODELS"

// oxlint-disable-next-line ren/no-comments -- Ren mints REN (the brain's host token, for Ren's own host: the host of REN_URL) and MODELS (the model keys). One mint at a time per workload; a 5xx is retried; a value is kept until 20 minutes before its expiry, so the old one stays in use until then (C29, C37; ren-v1 INV-24, INV-25, INV-26, OI-11).
export const layerMinted = Layer.effect(
  Minted,
  Effect.gen(function* () {
    const brains = yield* BrainClient.Service
    const grants = yield* Models.Service
    const renHost = new URL(brains.renUrl).hostname

    const Key = Schema.fromJsonString(
      Schema.Struct({ workload: Workload.Info, organizationId: Schema.String, revision: Schema.String }),
    )
    const encodeKey = Schema.encodeSync(Key)
    const decodeKey = Schema.decodeSync(Key)
    const keyOf = (scope: Credentials.Scope, revision = "") =>
      encodeKey({ workload: scope.workload, organizationId: scope.organizationId, revision })

    const hostTokens = yield* Cache.makeWith(
      (key: string) =>
        Effect.gen(function* () {
          const found = decodeKey(key)
          if (found.workload.kind !== "brain") return yield* Effect.die(new Error("Only a brain gets REN"))
          const token = yield* brains.hostToken({
            brainId: found.workload.id,
            generation: found.workload.generation,
            organizationId: Auth.OrganizationID.make(found.organizationId),
          })
          return { token, mintedAt: yield* Clock.currentTimeMillis }
        }),
      {
        capacity: 10_000,
        timeToLive: (exit) =>
          Exit.isSuccess(exit)
            ? Option.match(BrainToken.expiry(exit.value.token), {
                onNone: () => Duration.zero,
                onSome: (exp) => ttlUntil(exp * 1000, exit.value.mintedAt),
              })
            : Duration.zero,
      },
    )

    const modelGrants = yield* Cache.makeWith(
      (key: string) =>
        Effect.gen(function* () {
          const found = decodeKey(key)
          const access =
            found.workload.kind === "brain"
              ? yield* grants
                  .grant(found.workload.id, Auth.OrganizationID.make(found.organizationId))
                  .pipe(Effect.retry({ schedule: Schedule.exponential(Duration.millis(500)), times: 3 }))
              : { endpoints: [] }
          return { access, mintedAt: yield* Clock.currentTimeMillis }
        }),
      {
        capacity: 10_000,
        timeToLive: (exit) => {
          if (Exit.isFailure(exit)) return Duration.zero
          const expiries = exit.value.access.endpoints.flatMap((endpoint) =>
            endpoint.apiKey.expiresAt ? [endpoint.apiKey.expiresAt.epochMilliseconds] : [],
          )
          return expiries.length === 0 ? Duration.hours(1) : ttlUntil(Math.min(...expiries), exit.value.mintedAt)
        },
      },
    )

    const cachedHostToken = (scope: Credentials.Scope) =>
      Effect.map(Cache.get(hostTokens, keyOf(scope)), (found) => found.token)
    const cachedGrant = (scope: Credentials.Scope) =>
      Effect.flatMap(grants.revision, (revision) => Cache.get(modelGrants, keyOf(scope, revision)))

    return Minted.of({
      candidates: Effect.fn("CredentialSource.minted.candidates")(function* (scope: Credentials.Scope) {
        if (scope.workload.kind !== "brain") return []
        const granted = yield* cachedGrant(scope).pipe(Effect.option)
        const endpoints = Option.match(granted, { onNone: () => [], onSome: (found) => found.access.endpoints })
        return [
          {
            id: `minted:${ren}`,
            source: "minted",
            label: ren,
            owner: "workload",
            hosts: [renHost],
            inject: { op: "replace", in: ["header"] },
            revision: 0,
          },
          ...endpoints.flatMap((endpoint): ReadonlyArray<Credentials.Candidate> => {
            const url = URL.parse(endpoint.baseUrl)
            if (!url) return []
            return [
              {
                id: `minted:${models}:${endpoint.id}`,
                source: "minted",
                label: models,
                owner: "workload",
                hosts: [url.hostname],
                inject: { op: "replace", in: ["header"] },
                revision: 0,
              },
            ]
          }),
        ] satisfies ReadonlyArray<Credentials.Candidate>
      }),
      value: Effect.fn("CredentialSource.minted.value")(function* (
        candidate: Credentials.Candidate,
        scope: Credentials.Scope,
      ) {
        if (candidate.label === ren) {
          const token = yield* cachedHostToken(scope)
          return Option.some({
            value: { type: "key", value: Redacted.make(token) },
            ...Option.match(BrainToken.expiry(token), {
              onNone: () => ({}),
              onSome: (exp) => ({ expiresAt: DateTime.makeUnsafe(exp * 1000) }),
            }),
          } satisfies Sourced)
        }
        const granted = yield* cachedGrant(scope).pipe(
          Effect.mapError(
            () => new Unavailable({ label: candidate.label, message: "Ren could not mint the model key." }),
          ),
        )
        const endpoint = granted.access.endpoints.find((found) => candidate.id === `minted:${models}:${found.id}`)
        return Option.map(Option.fromNullishOr(endpoint), (found): Sourced => ({
          value: { type: "key", value: found.apiKey.key },
          ...(found.apiKey.expiresAt && { expiresAt: found.apiKey.expiresAt }),
        }))
      }),
      // oxlint-disable-next-line ren/no-comments -- After an upstream 401 on REN or MODELS, the next request mints again (§9 rule 7).
      forget: Effect.fn("CredentialSource.minted.forget")(function* (
        candidate: Credentials.Candidate,
        scope: Credentials.Scope,
      ) {
        if (candidate.label === ren) return yield* Cache.invalidate(hostTokens, keyOf(scope))
        yield* Cache.invalidate(modelGrants, keyOf(scope, yield* grants.revision))
      }),
    })
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sources = { static: yield* Static, minted: yield* Minted, provider: yield* Provider }
    const bySource: Readonly<Record<string, Source>> = sources
    const of = (candidate: Credentials.Candidate) => bySource[candidate.source] ?? sources.static
    return Service.of({
      candidates: Effect.fn("CredentialSource.candidates")(function* (
        scope: Credentials.Scope,
        profileIds: ReadonlyArray<AppProfile.ID>,
      ) {
        return [
          ...(yield* sources.minted.candidates(scope, profileIds)),
          ...(yield* sources.static.candidates(scope, profileIds)),
        ]
      }),
      value: (candidate, scope) => of(candidate).value(candidate, scope),
      forget: (candidate, scope) => of(candidate).forget(candidate, scope),
    })
  }),
)
