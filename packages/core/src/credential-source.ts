export * as CredentialSource from "./credential-source.js"

import { Database } from "@ren/db/database"
import { BrainToken } from "@ren/host-api/brain-token"
import type { AppProfile } from "@ren/schema/app-profile"
import { Credential } from "@ren/schema/credential"
import { Workload } from "@ren/schema/workload"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { and, eq, isNull, sql } from "drizzle-orm"
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
import { Access } from "./access.js"
import { BrainClient } from "./brain-client.js"
import { Credentials } from "./credentials.js"
import { Drives } from "./drives.js"
import { GitHubApp } from "./github-app.js"
import { McpProvider } from "./mcp-provider.js"
import { Models } from "./models.js"
import { SessionPolicy } from "./session/policy.js"

export type Value =
  | { readonly type: "key"; readonly value: Redacted.Redacted }
  | { readonly type: "basic"; readonly username: string; readonly password: Redacted.Redacted }
  | { readonly type: "fields"; readonly fields: Readonly<Record<string, Redacted.Redacted>> }
  | {
      readonly type: "route"
      readonly upstream: Redacted.Redacted
      readonly headers: ReadonlyArray<{ readonly name: string; readonly value: Redacted.Redacted }>
    }
  | {
      readonly type: "aws"
      readonly accessKeyId: string
      readonly secretAccessKey: Redacted.Redacted
      readonly sessionToken: Redacted.Redacted
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
const person = Models.personLabel

// oxlint-disable-next-line ren/no-comments -- Ren mints REN, MODELS, PERSON (space members only, AC4) and DRIVE (a brain's space and org drives, read-only); one mint at a time per workload (C29).
export const layerMinted = Layer.effect(
  Minted,
  Effect.gen(function* () {
    const brains = yield* BrainClient.Service
    const grants = yield* Models.Service
    const database = yield* Database.Service
    const access = yield* Access.Service
    const github = yield* GitHubApp.Service
    const drives = yield* Drives.Service
    const renHost = new URL(brains.renUrl).hostname

    const Key = Schema.fromJsonString(
      Schema.Struct({
        workload: Workload.Info,
        organizationId: Schema.String,
        spaceId: Schema.NullOr(Space.ID),
        revision: Schema.String,
      }),
    )
    const encodeKey = Schema.encodeSync(Key)
    const decodeKey = Schema.decodeSync(Key)
    const keyOf = (scope: Credentials.Scope, revision = "") =>
      encodeKey({
        workload: scope.workload,
        organizationId: scope.organizationId,
        spaceId: Option.getOrNull(scope.spaceId),
        revision,
      })

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
            found.workload.kind === "brain" && found.spaceId
              ? yield* grants
                  .grant(found.workload.id, Auth.OrganizationID.make(found.organizationId), found.spaceId)
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

    const DriveKey = Schema.fromJsonString(Schema.Struct({ organizationId: Auth.OrganizationID, spaceId: Space.ID }))
    const driveKeys = yield* Cache.makeWith(
      (key: string) =>
        Effect.gen(function* () {
          const keys = yield* drives.keys(Schema.decodeSync(DriveKey)(key))
          return { keys, mintedAt: yield* Clock.currentTimeMillis }
        }),
      {
        capacity: 10_000,
        timeToLive: (exit) =>
          Exit.isSuccess(exit)
            ? ttlUntil(DateTime.toEpochMillis(exit.value.keys.expiresAt), exit.value.mintedAt)
            : Duration.zero,
      },
    )

    const cachedHostToken = (scope: Credentials.Scope) =>
      Effect.map(Cache.get(hostTokens, keyOf(scope)), (found) => found.token)
    const cachedGrant = (scope: Credentials.Scope) =>
      Effect.flatMap(grants.revision, (revision) => Cache.get(modelGrants, keyOf(scope, revision)))

    return Minted.of({
      candidates: Effect.fn("CredentialSource.minted.candidates")(function* (scope: Credentials.Scope) {
        const installation = yield* github.installationOf(scope.organizationId)
        const gitHub = Option.match(installation, {
          onNone: (): ReadonlyArray<Credentials.Candidate> => [],
          onSome: (found): ReadonlyArray<Credentials.Candidate> => [
            {
              id: `minted:${GitHubApp.label}:${found.installation}`,
              source: "minted",
              label: GitHubApp.label,
              owner: "org",
              hosts: GitHubApp.hosts(found.client.settings),
              inject: { op: "replace", in: ["header"] },
              revision: 0,
            },
          ],
        })
        if (scope.workload.kind !== "brain") return gitHub
        const granted = yield* cachedGrant(scope).pipe(Effect.option)
        const endpoints = Option.match(granted, { onNone: () => [], onSome: (found) => found.access.endpoints })
        const modelHosts = [
          ...new Set(
            endpoints.flatMap((endpoint) =>
              Option.toArray(Option.fromNullishOr(URL.parse(endpoint.baseUrl)?.hostname)),
            ),
          ),
        ]
        const drive = Option.match(scope.spaceId, {
          onNone: (): ReadonlyArray<Credentials.Candidate> => [],
          onSome: (): ReadonlyArray<Credentials.Candidate> => [
            {
              id: `minted:${Drives.label}`,
              source: "minted",
              label: Drives.label,
              owner: "workload",
              hosts: drives.hosts,
              inject: { op: "awsSign" },
            },
          ],
        })
        return [
          ...drive,
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
          ...(modelHosts.length === 0
            ? []
            : [
                {
                  id: `minted:${person}`,
                  source: "minted",
                  label: person,
                  owner: "workload",
                  hosts: modelHosts,
                  inject: { op: "replace", in: ["header"] },
                } satisfies Credentials.Candidate,
              ]),
          ...gitHub,
        ] satisfies ReadonlyArray<Credentials.Candidate>
      }),
      value: Effect.fn("CredentialSource.minted.value")(function* (
        candidate: Credentials.Candidate,
        scope: Credentials.Scope,
      ) {
        if (candidate.label === person) {
          const rows = yield* database.db
            .select({
              id: Database.Schema.member.id,
              userId: Database.Schema.member.userId,
              role: Database.Schema.member.role,
              membershipId: Database.Schema.space_member.id,
            })
            .from(Database.Schema.member)
            .leftJoin(
              Database.Schema.space_member,
              and(
                eq(Database.Schema.space_member.user_id, Database.Schema.member.userId),
                Option.match(scope.spaceId, {
                  onNone: () => sql`false`,
                  onSome: (spaceId) => eq(Database.Schema.space_member.space_id, spaceId),
                }),
                isNull(Database.Schema.space_member.archived_at),
              ),
            )
            .where(eq(Database.Schema.member.organizationId, scope.organizationId))
            .pipe(Effect.orDie)
          const allowed = rows.filter((row) =>
            access.isAllowed({
              actor: {
                userId: Auth.UserID.make(row.userId),
                organizationId: scope.organizationId,
                roles: Auth.roles(row.role),
              },
              action: SessionPolicy.actions.send,
              resource: SessionPolicy.resource(Option.isSome(scope.spaceId) ? row.membershipId : null),
            }),
          )
          return Option.some({
            value: {
              type: "fields",
              fields: Object.fromEntries(allowed.map((row) => [row.id, Redacted.make(row.id)])),
            },
          } satisfies Sourced)
        }
        if (candidate.label === Drives.label) {
          if (scope.workload.kind !== "brain" || Option.isNone(scope.spaceId)) return Option.none()
          const live = yield* database.db
            .select({ id: Database.Schema.space.id })
            .from(Database.Schema.space)
            .where(and(eq(Database.Schema.space.id, scope.spaceId.value), isNull(Database.Schema.space.archived_at)))
            .pipe(Effect.orDie)
          if (live.length === 0) return Option.none()
          const minted = yield* Cache.get(
            driveKeys,
            Schema.encodeSync(DriveKey)({ organizationId: scope.organizationId, spaceId: scope.spaceId.value }),
          ).pipe(
            Effect.tapError((error) => Effect.logWarning("Ren could not mint drive keys", error)),
            Effect.mapError(
              () => new Unavailable({ label: candidate.label, message: "Ren could not mint the drive keys." }),
            ),
          )
          return Option.some({
            value: {
              type: "aws",
              accessKeyId: minted.keys.accessKeyId,
              secretAccessKey: minted.keys.secretAccessKey,
              sessionToken: minted.keys.sessionToken,
            },
            expiresAt: minted.keys.expiresAt,
          } satisfies Sourced)
        }
        if (candidate.label === GitHubApp.label) {
          const installation = yield* github.installationOf(scope.organizationId)
          if (
            Option.isNone(installation) ||
            candidate.id !== `minted:${GitHubApp.label}:${installation.value.installation}`
          )
            return Option.none()
          const minted = yield* installation.value.client.token(installation.value.installation).pipe(
            Effect.tapError((error) => Effect.logWarning("Ren could not mint a GitHub installation token", error)),
            Effect.mapError(
              () => new Unavailable({ label: candidate.label, message: "Ren could not mint the GitHub token." }),
            ),
          )
          return Option.some({
            value: { type: "key", value: minted.token },
            expiresAt: DateTime.makeUnsafe(minted.expiresAt),
          } satisfies Sourced)
        }
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
        if (candidate.label === person || candidate.label === Drives.label) return
        if (candidate.label === GitHubApp.label) {
          const installation = yield* github.installationOf(scope.organizationId)
          if (Option.isSome(installation)) yield* installation.value.client.forget(installation.value.installation)
          return
        }
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
