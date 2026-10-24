export * as CredentialSource from "./credential-source.js"

import { BrainToken } from "@ren/host-api/brain-token"
import { Credential } from "@ren/schema/credential"
import { Workload } from "@ren/schema/workload"
import { Auth } from "@ren/schema/auth"
import {
  Cache,
  Clock,
  Config,
  Context,
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

export class Unavailable extends Schema.TaggedError<Unavailable>()("CredentialSource.Unavailable", {
  label: Schema.String,
  message: Schema.String,
}) {}

export interface Source {
  readonly candidates: (scope: Credentials.Scope) => Effect.Effect<ReadonlyArray<Credentials.Candidate>>
  readonly value: (
    candidate: Credentials.Candidate,
    scope: Credentials.Scope,
  ) => Effect.Effect<Option.Option<Value>, Unavailable>
}

export class Static extends Context.Service<Static, Source>()("@ren/core/CredentialSource/Static") {}

export class Minted extends Context.Service<Minted, Source>()("@ren/core/CredentialSource/Minted") {}

export class Service extends Context.Service<Service, Source>()("@ren/core/CredentialSource") {}

// oxlint-disable-next-line ren/no-comments -- Pasted values: Ren opens the stored row with Envelope. A sign-in or a provider is another source (README §5).
export const layerStatic = Layer.effect(
  Static,
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    return Static.of({
      candidates: (scope) => credentials.candidates(scope),
      value: Effect.fn("CredentialSource.static")(function* (candidate: Credentials.Candidate) {
        if (!Schema.is(Credential.ID)(candidate.id)) return Option.none()
        const opened = yield* credentials.open(candidate.id)
        return Option.map(opened, (found): Value => found.value)
      }),
    })
  }),
)

const renewBefore = Duration.minutes(5)

const ttlUntil = (expiresAtMillis: number, now: number) =>
  Duration.millis(Math.max(0, expiresAtMillis - Duration.toMillis(renewBefore) - now))

const ren = "REN"
const models = "MODELS"

// oxlint-disable-next-line ren/no-comments -- Ren mints REN (the brain's host token, for ren.internal) and MODELS (the model keys). One mint at a time per workload; a 5xx is retried; a value is kept until 5 minutes before its expiry, so the old one stays in use until then (C29; ren-v1 INV-24, INV-25, INV-26, OI-11).
export const layerMinted = Layer.effect(
  Minted,
  Effect.gen(function* () {
    const brains = yield* BrainClient.Service
    const grants = yield* Models.Service
    const upstream = yield* Config.String("REN_EGRESS_UPSTREAM").pipe(
      Config.orElse(() => Config.String("REN_URL")),
      Config.withDefault("http://localhost:4000"),
    )

    const Key = Schema.fromJsonString(Schema.Struct({ workload: Workload.Info, organizationId: Schema.String }))
    const encodeKey = Schema.encodeSync(Key)
    const decodeKey = Schema.decodeSync(Key)
    const keyOf = (scope: Credentials.Scope) =>
      encodeKey({ workload: scope.workload, organizationId: scope.organizationId })

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
    const cachedGrant = (scope: Credentials.Scope) => Cache.get(modelGrants, keyOf(scope))

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
            hosts: ["ren.internal"],
            inject: { op: "route" },
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
                ...(url.pathname !== "/" && { pathPrefix: url.pathname.replace(/\/$/u, "") }),
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
            type: "route",
            upstream: Redacted.make(upstream),
            headers: [{ name: "Authorization", value: Redacted.make(`Bearer ${token}`) }],
          } satisfies Value)
        }
        const granted = yield* cachedGrant(scope).pipe(
          Effect.mapError(
            () => new Unavailable({ label: candidate.label, message: "Ren could not mint the model key." }),
          ),
        )
        const endpoint = granted.access.endpoints.find((found) => candidate.id === `minted:${models}:${found.id}`)
        return Option.map(Option.fromNullishOr(endpoint), (found): Value => ({ type: "key", value: found.apiKey.key }))
      }),
    })
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sources = { static: yield* Static, minted: yield* Minted }
    return Service.of({
      candidates: Effect.fn("CredentialSource.candidates")(function* (scope: Credentials.Scope) {
        return [...(yield* sources.minted.candidates(scope)), ...(yield* sources.static.candidates(scope))]
      }),
      value: (candidate, scope) =>
        candidate.source === "minted" ? sources.minted.value(candidate, scope) : sources.static.value(candidate, scope),
    })
  }),
)
