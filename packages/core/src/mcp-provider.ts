export * as McpProvider from "./mcp-provider.js"

import type { Credential } from "@ren/schema/credential"
import { Auth } from "@ren/schema/auth"
import { Cache, Clock, Config, Context, Duration, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { WorkflowEngine } from "effect/workflow"
import { DurableRunner } from "./durable-runner.js"
import { Envelope } from "./envelope.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("McpProvider.Unavailable", {
  message: Schema.String,
}) {}

export class Failed extends Schema.TaggedError<Failed>()("McpProvider.Failed", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

export interface Session {
  readonly upstream: string
  readonly sessionId: string
}

export interface Provider {
  readonly id: Credential.Provider
  readonly connect: (input: {
    readonly credentialId: Credential.ID
    readonly toolkit: string
    readonly callbackUrl: string
  }) => Effect.Effect<{ readonly redirectUrl: string; readonly accountId: string }, Failed>
  readonly active: (accountId: string) => Effect.Effect<boolean, Failed>
  readonly session: (input: {
    readonly credentialId: Credential.ID
    readonly toolkit: string
    readonly accountId: string
  }) => Effect.Effect<Session, Failed>
  readonly status: (accountId: string) => Effect.Effect<string, Failed>
  readonly liveStatus: (accountId: string) => Effect.Effect<string, Failed>
  readonly removeSession: (sessionId: string) => Effect.Effect<void, Failed>
  readonly removeAccount: (accountId: string) => Effect.Effect<void, Failed>
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: Redacted.Redacted }>
}

export interface Interface {
  readonly get: (id: Credential.Provider) => Effect.Effect<Provider, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/McpProvider") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({ get: (id) => Effect.fail(new Unavailable({ message: `${id} is not set up on this Ren` })) }),
)

export const activeWait = Duration.seconds(10)

export const statusKept = Duration.minutes(5)

const AuthConfigs = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) })
const CreatedAuthConfig = Schema.Struct({ auth_config: Schema.Struct({ id: Schema.String }) })
const Link = Schema.Struct({ redirect_url: Schema.String, connected_account_id: Schema.String })
const Account = Schema.Struct({ status: Schema.String })
const CreatedSession = Schema.Struct({ session_id: Schema.String, mcp: Schema.Struct({ url: Schema.String }) })

// oxlint-disable-next-line ren/no-comments -- §10 (P1, K20 to K24): COMPOSIO_API_KEY stays in Ren; without it a Composio connect fails with Unavailable. The auth config is found or created at run time per toolkit and kept in memory. The Composio user is the credential id; each session enables one toolkit, pins the account, and turns off connection management, the workbench, proxy execute and instant tools. Calls go to REST v3.1 with Effect's HttpClient.
export const layerComposio = Layer.effect(
  Service,
  Effect.gen(function* () {
    const key = yield* Config.option(Config.Redacted("COMPOSIO_API_KEY"))
    const base = (yield* Config.String("COMPOSIO_URL").pipe(
      Config.withDefault("https://backend.composio.dev"),
    )).replace(/\/$/u, "")
    const http = yield* HttpClient.HttpClient
    if (Option.isNone(key)) return Service.of(layerNoneService)
    const apiKey = key.value

    const call = <A, I>(schema: Schema.Codec<A, I>, method: "GET" | "POST" | "DELETE", path: string, body?: unknown) =>
      Effect.gen(function* () {
        const request = HttpClientRequest.make(method)(`${base}/api/v3.1${path}`).pipe(
          HttpClientRequest.setHeader("x-api-key", Redacted.value(apiKey)),
          HttpClientRequest.acceptJson,
          body ? HttpClientRequest.bodyJsonUnsafe(body) : (self) => self,
        )
        const response = yield* http.execute(request).pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError((cause) => new Failed({ message: `Composio did not answer: ${String(cause)}` })),
        )
        if (response.status < 200 || response.status >= 300)
          return yield* new Failed({
            message: `Composio answered ${response.status} to ${method} ${path}`,
            status: response.status,
          })
        const json = yield* response.json.pipe(Effect.mapError(() => new Failed({ message: "Composio sent no JSON" })))
        return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
          Effect.mapError(() => new Failed({ message: `Composio sent an unexpected answer to ${path}` })),
        )
      })

    const authConfigs = yield* Cache.makeWith(
      (toolkit: string) =>
        Effect.gen(function* () {
          const found = yield* call(
            AuthConfigs,
            "GET",
            `/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}&is_composio_managed=true`,
          )
          const existing = found.items.at(0)
          if (existing) return existing.id
          const created = yield* call(CreatedAuthConfig, "POST", "/auth_configs", {
            toolkit: { slug: toolkit },
            auth_config: { type: "use_composio_managed_auth" },
          })
          return created.auth_config.id
        }),
      { capacity: 1000, timeToLive: (exit) => (exit._tag === "Success" ? Duration.infinity : Duration.zero) },
    )

    const statuses = yield* Cache.makeWith(
      (accountId: string) =>
        Effect.map(call(Account, "GET", `/connected_accounts/${accountId}`), (account) => account.status),
      { capacity: 10_000, timeToLive: (exit) => (exit._tag === "Success" ? statusKept : Duration.zero) },
    )

    const readStatus = (accountId: string) =>
      Effect.map(call(Account, "GET", `/connected_accounts/${accountId}`), (account) => account.status)

    const provider: Provider = {
      id: "composio",
      connect: Effect.fn("McpProvider.composio.connect")(function* (input) {
        const link = yield* call(Link, "POST", "/connected_accounts/link", {
          auth_config_id: yield* Cache.get(authConfigs, input.toolkit),
          user_id: input.credentialId,
          callback_url: input.callbackUrl,
        })
        return { redirectUrl: link.redirect_url, accountId: link.connected_account_id }
      }),
      // oxlint-disable-next-line ren/no-comments -- K23 (P4): once per second, for at most 10 seconds.
      active: (accountId) =>
        readStatus(accountId).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(Duration.seconds(1)),
            until: (status) => status === "ACTIVE",
            times: Duration.toSeconds(activeWait),
          }),
          Effect.map((status) => status === "ACTIVE"),
        ),
      session: Effect.fn("McpProvider.composio.session")(function* (input) {
        const created = yield* call(CreatedSession, "POST", "/tool_router/session", {
          user_id: input.credentialId,
          toolkits: { enable: [input.toolkit] },
          auth_configs: { [input.toolkit]: yield* Cache.get(authConfigs, input.toolkit) },
          connected_accounts: { [input.toolkit]: [input.accountId] },
          manage_connections: { enable: false },
          workbench: { enable: false },
          proxy_execute: { enable: false },
          instant: false,
        })
        return { upstream: created.mcp.url, sessionId: created.session_id }
      }),
      status: (accountId) => Cache.get(statuses, accountId),
      liveStatus: (accountId) => Effect.tap(readStatus(accountId), () => Cache.invalidate(statuses, accountId)),
      removeSession: (sessionId) =>
        call(Schema.Unknown, "DELETE", `/tool_router/session/${sessionId}`).pipe(Effect.asVoid),
      removeAccount: (accountId) =>
        call(Schema.Unknown, "DELETE", `/connected_accounts/${accountId}?revoke_on_delete=true`).pipe(Effect.asVoid),
      headers: [{ name: "x-api-key", value: apiKey }],
    }
    return Service.of({ get: () => Effect.succeed(provider) })
  }),
)

const layerNoneService: Interface = {
  get: (id) => Effect.fail(new Unavailable({ message: `${id} is not set up on this Ren (COMPOSIO_API_KEY)` })),
}

// oxlint-disable-next-line ren/no-comments -- `sealed` is a deleted credential's value; the run opens it for the session id, so a delete inside a transaction needs no Envelope.
export interface Leftover {
  readonly provider: Credential.Provider
  readonly sessionId?: string | undefined
  readonly accountId?: string | undefined
  readonly sealed?:
    | {
        readonly organizationId: Auth.OrganizationID
        readonly credentialId: string
        readonly value: Envelope.Sealed
      }
    | undefined
}

export interface CleanupInterface {
  readonly start: (leftover: Leftover) => Effect.Effect<void>
  readonly wait: (leftover: Leftover) => Effect.Effect<void>
}

// oxlint-disable-next-line ren/no-comments -- What deletes a provider's session and account after Ren no longer needs them. The default does nothing, so code that deletes credentials needs no provider to run.
export class Cleanup extends Context.Reference<CleanupInterface>("@ren/core/McpProvider/Cleanup", {
  defaultValue: () => ({ start: () => Effect.void, wait: () => Effect.void }),
}) {}

export const cleanupFor = Duration.hours(24)

const backoff = Schedule.exponential(Duration.minutes(1)).pipe(
  Schedule.modifyDelay((metadata) => Effect.succeed(Duration.min(metadata.duration, Duration.hours(1)))),
)

const CleanupRun = DurableRunner.make("McpProviderCleanup", {
  payload: {
    provider: Schema.Literals(["composio"]),
    sessionId: Schema.optional(Schema.String),
    accountId: Schema.optional(Schema.String),
    sealed: Schema.optional(
      Schema.Struct({ organizationId: Auth.OrganizationID, credentialId: Schema.String, value: Envelope.Sealed }),
    ),
  },
  idempotencyKey: (payload) =>
    `${payload.provider}-cleanup:${payload.accountId ?? payload.sessionId ?? payload.sealed?.credentialId ?? ""}`,
})

// oxlint-disable-next-line ren/no-comments -- §10 rule 9 (K27): delete the session, then the account with `revoke_on_delete=true`; one already gone counts as done. A failure retries with a backoff from 1 minute to 1 hour; after 24 hours it stops, logs both ids and alerts.
export const cleanUp = Effect.fnUntraced(function* (
  provider: Provider,
  leftover: { readonly sessionId?: string | undefined; readonly accountId?: string | undefined },
) {
  const started = yield* Clock.currentTimeMillis
  const gone = (error: Failed) => error.status === 404
  const attempt = Effect.gen(function* () {
    if (leftover.sessionId)
      yield* provider.removeSession(leftover.sessionId).pipe(Effect.catchIf(gone, () => Effect.void))
    if (leftover.accountId)
      yield* provider.removeAccount(leftover.accountId).pipe(Effect.catchIf(gone, () => Effect.void))
  })
  yield* attempt.pipe(
    Effect.tapError((error) => Effect.logWarning(`The ${provider.id} cleanup failed; it retries`, error)),
    Effect.retry({
      schedule: backoff,
      while: () => Effect.map(Clock.currentTimeMillis, (now) => now - started < Duration.toMillis(cleanupFor)),
    }),
    Effect.catchCause(() =>
      Effect.logError(`alert: the ${provider.id} cleanup stopped after 24 hours`).pipe(
        Effect.annotateLogs({
          alert: "provider_cleanup",
          session: leftover.sessionId ?? "",
          account: leftover.accountId ?? "",
        }),
      ),
    ),
  )
})

// oxlint-disable-next-line ren/no-comments -- One durable run per leftover, so a cleanup survives a restart of Ren.
export const layerCleanup = Layer.effect(
  Cleanup,
  Effect.gen(function* () {
    const providers = yield* Service
    const envelope = yield* Envelope.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const RouteJson = Schema.fromJsonString(Schema.Struct({ type: Schema.Literal("route"), sessionId: Schema.String }))
    const sessionOf = (payload: typeof CleanupRun.payloadSchema.Type) =>
      payload.sealed
        ? envelope
            .open(payload.sealed.value, {
              organizationId: payload.sealed.organizationId,
              kind: "credential",
              id: payload.sealed.credentialId,
            })
            .pipe(
              Effect.map((opened) =>
                Option.getOrUndefined(
                  Option.map(Schema.decodeUnknownOption(RouteJson)(Redacted.value(opened)), (value) => value.sessionId),
                ),
              ),
              Effect.orElseSucceed(() => payload.sessionId),
            )
        : Effect.succeed(payload.sessionId)
    yield* DurableRunner.register(CleanupRun, (payload) =>
      Effect.gen(function* () {
        const provider = yield* providers.get(payload.provider)
        const sessionId = yield* sessionOf(payload)
        yield* cleanUp(provider, { ...payload, sessionId })
      }).pipe(Effect.catchTag("McpProvider.Unavailable", (error) => Effect.logError(`alert: ${error.message}`))),
    )
    return Cleanup.of({
      start: (leftover) =>
        leftover.sessionId || leftover.accountId || leftover.sealed
          ? DurableRunner.ensure(CleanupRun, leftover).pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
            )
          : Effect.void,
      // oxlint-disable-next-line ren/no-comments -- Joins the run of this leftover, started or not; a finished run returns at once.
      wait: (leftover) =>
        CleanupRun.execute(leftover).pipe(Effect.asVoid, Effect.provideService(WorkflowEngine.WorkflowEngine, engine)),
    })
  }),
)
