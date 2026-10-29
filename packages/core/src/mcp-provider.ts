export * as McpProvider from "./mcp-provider.js"

import { Auth } from "@ren/schema/auth"
import type { Credential } from "@ren/schema/credential"
import {
  Cache,
  Clock,
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
} from "effect"
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
  isFatal: Schema.optional(Schema.Boolean).annotate({ description: "The account is gone; a retry cannot help." }),
}) {}

// oxlint-disable-next-line ren/no-comments -- The provider's own state for one credential. Core seals it and never reads it (P39).
export const State = Schema.Json
export type State = typeof State.Type

export const AccountStatus = Schema.Literals(["active", "pending", "gone"])
export type AccountStatus = typeof AccountStatus.Type

export interface Route {
  readonly upstream: Redacted.Redacted
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: Redacted.Redacted }>
  readonly expiresAt?: DateTime.Utc
}

// oxlint-disable-next-line ren/no-comments -- profiles.md §14, in Ren words only (P39). `account` is the provider's id for the person's account; each credential pins one, so the provider never picks one (K24). `remove` counts "already gone" as done.
export interface Provider {
  readonly id: Credential.Provider
  readonly connect: (input: {
    readonly credentialId: Credential.ID
    readonly integration: string
    readonly callbackUrl: string
  }) => Effect.Effect<{ readonly redirectUrl: string; readonly account: string }, Failed>
  readonly status: (account: string) => Effect.Effect<AccountStatus, Failed>
  readonly open: (input: {
    readonly credentialId: Credential.ID
    readonly integration: string
    readonly account: string
  }) => Effect.Effect<State, Failed>
  readonly route: (state: State) => Effect.Effect<Route, Failed>
  readonly renew: (state: State) => Effect.Effect<State, Failed>
  readonly remove: (input: { readonly state?: State; readonly account?: string }) => Effect.Effect<void, Failed>
}

export interface RegistryInterface {
  readonly get: (id: Credential.Provider) => Effect.Effect<Provider, Unavailable>
}

export const registryOf = (providers: ReadonlyArray<Provider>): RegistryInterface => ({
  get: (id) => {
    const provider = providers.find((found) => found.id === id)
    return provider
      ? Effect.succeed(provider)
      : Effect.fail(new Unavailable({ message: `The provider ${id} is not set up on this Ren` }))
  },
})

// oxlint-disable-next-line ren/no-comments -- §14 rule 1 (P38): the deployment's providers. A provider layer adds itself to the registry it finds; with none, every provider id is Unavailable and apps still decode.
export class Registry extends Context.Reference<RegistryInterface>("@ren/core/McpProvider/Registry", {
  defaultValue: () => registryOf([]),
}) {}

export const layer = <E, R>(providers: ReadonlyArray<Effect.Effect<Option.Option<Provider>, E, R>>) =>
  Layer.effect(
    Registry,
    Effect.map(Effect.all(providers), (found) => registryOf(found.flatMap((provider) => Option.toArray(provider)))),
  )

export const activeWait = Duration.seconds(10)

export const statusKept = Duration.minutes(5)

const AuthConfigs = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) })
const CreatedAuthConfig = Schema.Struct({ auth_config: Schema.Struct({ id: Schema.String }) })
const Link = Schema.Struct({ redirect_url: Schema.String, connected_account_id: Schema.String })
const Account = Schema.Struct({ status: Schema.String })
const CreatedSession = Schema.Struct({ session_id: Schema.String, mcp: Schema.Struct({ url: Schema.String }) })
const ComposioState = Schema.Struct({
  sessionId: Schema.String,
  url: Schema.String,
  user: Schema.String,
  integration: Schema.String,
  account: Schema.String,
})
const decodeComposioState = Schema.decodeUnknownOption(ComposioState)

const composioStatus = (status: string): AccountStatus => {
  if (status === "ACTIVE") return "active"
  if (status === "INITIATED" || status === "INITIALIZING") return "pending"
  return "gone"
}

// oxlint-disable-next-line ren/no-comments -- connections.md §10 (K20 to K24): COMPOSIO_API_KEY stays in Ren; without it the layer adds nothing. The auth config is found or created at run time per toolkit and kept in memory. The Composio user is the credential id; each session enables one toolkit, pins the account, and turns off connection management, the workbench, proxy execute and instant tools. Calls go to REST v3.1 with Effect's HttpClient. An ACTIVE status is kept 5 minutes.
export const composio = Effect.gen(function* () {
  const key = yield* Config.option(Config.Redacted("COMPOSIO_API_KEY"))
  const base = (yield* Config.String("COMPOSIO_URL").pipe(Config.withDefault("https://backend.composio.dev"))).replace(
    /\/$/u,
    "",
  )
  const http = yield* HttpClient.HttpClient
  if (Option.isNone(key)) return Option.none<Provider>()
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
    (account: string) =>
      Effect.map(call(Account, "GET", `/connected_accounts/${account}`), (found) => composioStatus(found.status)),
    {
      capacity: 10_000,
      timeToLive: (exit) => (exit._tag === "Success" && exit.value === "active" ? statusKept : Duration.zero),
    },
  )

  const session = Effect.fnUntraced(function* (input: {
    readonly user: string
    readonly integration: string
    readonly account: string
  }) {
    const created = yield* call(CreatedSession, "POST", "/tool_router/session", {
      user_id: input.user,
      toolkits: { enable: [input.integration] },
      auth_configs: { [input.integration]: yield* Cache.get(authConfigs, input.integration) },
      connected_accounts: { [input.integration]: [input.account] },
      manage_connections: { enable: false },
      workbench: { enable: false },
      proxy_execute: { enable: false },
      instant: false,
    })
    return Schema.encodeSync(ComposioState)({ ...input, sessionId: created.session_id, url: created.mcp.url })
  })

  const stateOf = (state: State) =>
    Option.match(decodeComposioState(state), {
      onNone: () => Effect.fail(new Failed({ message: "The Composio state is damaged" })),
      onSome: Effect.succeed,
    })

  const gone = (error: Failed) => error.status === 404

  const provider: Provider = {
    id: "composio",
    connect: Effect.fn("McpProvider.composio.connect")(function* (input) {
      const link = yield* call(Link, "POST", "/connected_accounts/link", {
        auth_config_id: yield* Cache.get(authConfigs, input.integration),
        user_id: input.credentialId,
        callback_url: input.callbackUrl,
      })
      return { redirectUrl: link.redirect_url, account: link.connected_account_id }
    }),
    status: (account) => Cache.get(statuses, account),
    open: (input) => session({ user: input.credentialId, integration: input.integration, account: input.account }),
    route: Effect.fn("McpProvider.composio.route")(function* (state) {
      const found = yield* stateOf(state)
      return { upstream: Redacted.make(found.url), headers: [{ name: "x-api-key", value: apiKey }] }
    }),
    // oxlint-disable-next-line ren/no-comments -- K29: a new session for the same account; the caller cleans up the old one.
    renew: Effect.fn("McpProvider.composio.renew")(function* (state) {
      const found = yield* stateOf(state)
      yield* Cache.invalidate(statuses, found.account)
      if ((yield* Cache.get(statuses, found.account)) !== "active")
        return yield* new Failed({ message: "The Composio account is not active", isFatal: true })
      return yield* session(found)
    }),
    remove: Effect.fn("McpProvider.composio.remove")(function* (input) {
      const found = input.state ? Option.getOrUndefined(decodeComposioState(input.state)) : undefined
      if (found)
        yield* call(Schema.Unknown, "DELETE", `/tool_router/session/${found.sessionId}`).pipe(
          Effect.catchIf(gone, () => Effect.void),
        )
      if (input.account)
        yield* call(Schema.Unknown, "DELETE", `/connected_accounts/${input.account}?revoke_on_delete=true`).pipe(
          Effect.catchIf(gone, () => Effect.void),
        )
    }),
  }
  return Option.some(provider)
})

export const layerComposio = layer([composio])

// oxlint-disable-next-line ren/no-comments -- K23: wait until the account is active, once per second for at most 10 seconds.
export const waitActive = (provider: Provider, account: string) =>
  provider.status(account).pipe(
    Effect.repeat({
      schedule: Schedule.spaced(Duration.seconds(1)),
      until: (status) => status !== "pending",
      times: Duration.toSeconds(activeWait),
    }),
    Effect.map((status) => status === "active"),
  )

// oxlint-disable-next-line ren/no-comments -- `sealed` is a deleted credential's value; the run opens it for the state, so a delete inside a transaction needs no Envelope.
export interface Leftover {
  readonly provider: Credential.Provider
  readonly state?: State | undefined
  readonly account?: string | undefined
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

// oxlint-disable-next-line ren/no-comments -- What deletes a provider's state and account after Ren no longer needs them. The default does nothing, so code that deletes credentials needs no provider to run.
export class Cleanup extends Context.Reference<CleanupInterface>("@ren/core/McpProvider/Cleanup", {
  defaultValue: () => ({ start: () => Effect.void, wait: () => Effect.void }),
}) {}

export const cleanupFor = Duration.hours(24)

const backoff = Schedule.exponential(Duration.minutes(1)).pipe(
  Schedule.modifyDelay((metadata) => Effect.succeed(Duration.min(metadata.duration, Duration.hours(1)))),
)

const CleanupRun = DurableRunner.make("McpProviderCleanup", {
  payload: {
    provider: Schema.String,
    state: Schema.optional(State),
    account: Schema.optional(Schema.String),
    sealed: Schema.optional(
      Schema.Struct({ organizationId: Auth.OrganizationID, credentialId: Schema.String, value: Envelope.Sealed }),
    ),
  },
  idempotencyKey: (payload) =>
    `${payload.provider}-cleanup:${payload.account ?? payload.sealed?.credentialId ?? JSON.stringify(payload.state ?? null)}`,
})

// oxlint-disable-next-line ren/no-comments -- connections.md §10 rule 9 (K27): remove the state, then the account; one already gone counts as done. A failure retries with a backoff from 1 minute to 1 hour; after 24 hours it stops, logs and alerts.
export const cleanUp = Effect.fnUntraced(function* (
  provider: Provider,
  leftover: { readonly state?: State | undefined; readonly account?: string | undefined },
) {
  const started = yield* Clock.currentTimeMillis
  yield* provider
    .remove({
      ...(leftover.state && { state: leftover.state }),
      ...(leftover.account && { account: leftover.account }),
    })
    .pipe(
      Effect.tapError((error) => Effect.logWarning(`The ${provider.id} cleanup failed; it retries`, error)),
      Effect.retry({
        schedule: backoff,
        while: () => Effect.map(Clock.currentTimeMillis, (now) => now - started < Duration.toMillis(cleanupFor)),
      }),
      Effect.catchCause(() =>
        Effect.logError("A provider's cleanup stopped after 24 hours").pipe(
          Effect.annotateLogs({ provider: provider.id, account: leftover.account ?? "" }),
        ),
      ),
    )
})

const RouteJson = Schema.fromJsonString(Schema.Struct({ type: Schema.Literal("route"), state: State }))

// oxlint-disable-next-line ren/no-comments -- One durable run per leftover, so a cleanup survives a restart of Ren.
export const layerCleanup = Layer.effect(
  Cleanup,
  Effect.gen(function* () {
    const registry = yield* Registry
    const envelope = yield* Envelope.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const stateOf = (payload: typeof CleanupRun.payloadSchema.Type) =>
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
                  Option.map(Schema.decodeUnknownOption(RouteJson)(Redacted.value(opened)), (value) => value.state),
                ),
              ),
              Effect.orElseSucceed(() => payload.state),
            )
        : Effect.succeed(payload.state)
    yield* DurableRunner.register(CleanupRun, (payload) =>
      Effect.gen(function* () {
        const provider = yield* registry.get(payload.provider)
        yield* cleanUp(provider, { state: yield* stateOf(payload), account: payload.account })
      }).pipe(
        Effect.catchTag("McpProvider.Unavailable", (error) =>
          Effect.logError("A provider's cleanup cannot run").pipe(Effect.annotateLogs({ reason: error.message })),
        ),
      ),
    )
    return Cleanup.of({
      start: (leftover) =>
        leftover.state || leftover.account || leftover.sealed
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
