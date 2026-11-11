import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { BrainProvider } from "@ren/core/brain-provider"
import { Access } from "@ren/core/access"
import { CredentialCallers } from "@ren/core/credential-callers"
import { CredentialRefresh } from "@ren/core/credential-refresh"
import { CredentialSource } from "@ren/core/credential-source"
import { CredentialEnv } from "@ren/core/credential-env"
import { Credentials } from "@ren/core/credentials"
import { Egress } from "@ren/core/egress"
import { OAuth } from "@ren/core/oauth"
import { OAuthFetch } from "@ren/core/oauth-fetch"
import { McpProvider } from "@ren/core/mcp-provider"
import { ProviderConnect } from "@ren/core/mcp-provider/connect"
import { AppProfiles } from "@ren/core/app/profiles"
import { Envelope } from "@ren/core/envelope"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { BrainPush } from "@ren/core/brain-push"
import { BrainLifecycle } from "@ren/core/brain-lifecycle"
import { Bundles } from "@ren/core/bundles"
import { ProviderCheck } from "@ren/core/provider-check"
import { Brains } from "@ren/core/brains"
import { SpaceShutdown } from "@ren/core/space-shutdown"
import { ChannelNotice } from "@ren/core/channel-notice"
import { ChannelSecrets } from "@ren/core/channel-secrets"
import { ChannelProvider } from "@ren/core/channel-provider"
import { GitHub } from "@ren/core/channel-provider/github"
import { Slack } from "@ren/core/channel-provider/slack"
import { GitHubAccounts } from "@ren/core/github-accounts"
import { GitHubApp } from "@ren/core/github-app"
import { GitHubTaskCard } from "@ren/core/github-task-card"
import { PersonCredentials } from "@ren/core/person-credentials"
import { ChannelIdentity } from "@ren/core/channel-identity"
import { ChannelRoute } from "@ren/core/channel-route"
import { Drives } from "@ren/core/drives"
import { Integrations } from "@ren/core/integrations"
import { Deployment } from "@ren/core/deployment"
import { Billing } from "@ren/core/billing"
import { BillingEnrollment } from "@ren/core/billing-enrollment"
import { DurableRunner } from "@ren/core/durable-runner"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Docker } from "@ren/core/machine-provider/docker"
import { Environments } from "@ren/core/environments"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
import { RenInference } from "@ren/core/ren-inference"
import { RenInferenceRemoval } from "@ren/core/ren-inference-removal"
import { Retention } from "@ren/core/retention"
import { SandboxEgress } from "@ren/core/sandbox-egress"
import { E2BSandbox } from "@ren/core/machine-provider/e2b"
import { SandboxUsage } from "@ren/core/sandbox-usage"
import { Usage } from "@ren/core/usage"
import { LocalSandbox } from "@ren/core/machine-provider/local"
import { Settings } from "@ren/core/settings"
import { SignupGuard } from "@ren/core/signup-guard"
import { TranscriptCodec } from "@ren/core/transcript-codec"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Observability } from "@ren/schema/observability"
import { PostHog } from "@ren/telemetry/posthog"
import { Telemetry } from "@ren/telemetry/telemetry"
import { Config, Effect, Layer, Option, References } from "effect"
import { FetchHttpClient, type HttpClient, HttpRouter } from "effect/http"
import type { ChildProcessSpawner } from "effect/process"
import { PersistedQueue } from "effect/persistence"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { EgressRoutes } from "./egress.js"
import { IntakeOrigins } from "./intake-origins.js"
import { Routes } from "./routes.js"
import { Signer } from "@ren/core/signer"
import { SlackApp } from "@ren/core/slack-app"
import { SlackTaskCard } from "@ren/core/slack-task-card"
import { TaskCard } from "@ren/core/task-card"
import { EgressControl } from "@ren/core/egress-control"
import { EnvironmentNetwork } from "@ren/core/environment-network"
import { AppResolve } from "@ren/core/app/resolve"

// oxlint-disable-next-line ren/no-comments -- Every stored credential is sealed with ENVELOPE_KEYS; without a key the server would start and then refuse each credential save, so it does not start.
const envelope = Layer.unwrap(Effect.as(Config.Redacted("ENVELOPE_KEYS"), Envelope.layerLocal))

// oxlint-disable-next-line ren/no-comments -- One proxy login per machine for brains and remote hands. An E2B brain without the egress would fetch the real model key, and in e2b-space the agent's code runs in the same sandbox, so the server does not start without EGRESS_PROXY_ADDRESS.
const sandboxEgress = Layer.unwrap(
  Effect.map(Config.String("SANDBOX_PROVIDER").pipe(Config.withDefault("local")), (provider) =>
    provider === "e2b" ? SandboxEgress.layer : SandboxEgress.layerConfig,
  ),
).pipe(Layer.provide(CredentialCallers.layer), Layer.provide(envelope))

const environmentNetwork = EnvironmentNetwork.layer.pipe(Layer.provide([AppResolve.layer, Bundles.layer]))

// oxlint-disable-next-line ren/no-comments -- Remote hands need what brains need: the egress, Ren's code and the host list of their template.
const environments = Environments.layer.pipe(Layer.provide([sandboxEgress, Bundles.layer, environmentNetwork]))

// oxlint-disable-next-line ren/no-comments -- The deployment's brain providers (EN2). A Ren whose brains run in cells registers none, so a space's provider checks pass.
const brainProviders = Layer.unwrap(
  Effect.gen(function* () {
    const provider = yield* Config.Literals(["local", "e2b", "cell"], "SANDBOX_PROVIDER").pipe(
      Config.withDefault("local"),
    )
    if (provider === "cell") return BrainProvider.layer([])
    if (provider === "e2b") return BrainProvider.layer([E2BSandbox.provider])
    const root = yield* Config.String("LOCAL_BRAIN_ROOT").pipe(Config.withDefault(join(tmpdir(), "ren-brains")))
    const entry = yield* Config.String("LOCAL_BRAIN_ENTRY").pipe(
      Config.withDefault(join(import.meta.dir, "../../cell/src/bun.ts")),
    )
    const executor = yield* Config.String("LOCAL_EXECUTOR_ENTRY").pipe(
      Config.withDefault(join(import.meta.dir, "../../executor/src/main.ts")),
    )
    const owner = yield* Config.option(Config.Int("LOCAL_BRAIN_OWNER"))
    return BrainProvider.layer([
      LocalSandbox.provider({
        entry,
        executor,
        root,
        ...Option.match(owner, { onNone: () => ({}), onSome: (pid) => ({ owner: pid }) }),
      }),
    ])
  }),
)

// oxlint-disable-next-line ren/no-comments -- E2B makes hands as well as brains: its templates are co-located hands today (EN3).
const handProviders = Layer.unwrap<
  EnvironmentProvider.Registry,
  Config.ConfigError,
  HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner,
  Config.ConfigError,
  never
>(
  Effect.gen(function* () {
    const provider = yield* Config.String("SANDBOX_PROVIDER").pipe(Config.withDefault("local"))
    if (provider === "e2b") return EnvironmentProvider.layer([E2BSandbox.provider])
    return EnvironmentProvider.layer([Docker.provider])
  }),
)

const host = Layer.unwrap(
  Effect.map(
    Config.Literals(["local", "e2b", "cell"], "SANDBOX_PROVIDER").pipe(Config.withDefault("local")),
    (provider) =>
      provider === "cell"
        ? BrainHost.layerCell
        : BrainHost.layerSandbox.pipe(
            Layer.provide(
              BrainLifecycle.layer.pipe(
                Layer.provide(sandboxEgress),
                Layer.provide(Bundles.layer),
                Layer.provide(environmentNetwork),
              ),
            ),
            Layer.merge(SandboxUsage.layer.pipe(Layer.provide(Usage.layer))),
            Layer.merge(Layer.effectDiscard(ProviderCheck.run.pipe(Effect.orDie))),
          ),
  ),
)

const models = Layer.unwrap(
  Effect.map(Config.option(Config.String("REN_INFERENCE_URL")), (url) =>
    Option.isSome(url)
      ? Models.layerRenInference
      : Models.layerInferenceGateway.pipe(Layer.provide(FetchHttpClient.layer)),
  ),
).pipe(Layer.provideMerge(RenInference.layerConfig), Layer.provide(Access.layer))

const credentials = Layer.mergeAll(Egress.layer, OAuth.layer).pipe(
  Layer.provideMerge(ProviderConnect.layer),
  Layer.provideMerge(
    CredentialRefresh.layer.pipe(Layer.provide(ProviderConnect.layerRefresher), Layer.provide(OAuth.layerRefresher)),
  ),
  Layer.provideMerge(AppProfiles.layer),
  Layer.provideMerge(CredentialSource.layer),
  Layer.provideMerge(
    Layer.mergeAll(CredentialSource.layerStatic, CredentialSource.layerMinted, CredentialSource.layerProvider),
  ),
  Layer.provideMerge(Drives.layer),
  Layer.provideMerge(GitHubAccounts.layer),
  Layer.provideMerge(Layer.mergeAll(Credentials.layer, CredentialCallers.layer, PersonCredentials.layer)),
  Layer.provideMerge(SlackApp.layer.pipe(Layer.provideMerge(ChannelSecrets.layer))),
  Layer.provideMerge(McpProvider.layerCleanup),
  Layer.provideMerge(McpProvider.layer([McpProvider.composio])),
  Layer.provideMerge(Layer.mergeAll(envelope, Access.layer, OAuthFetch.layerPublic)),
)

const observability = Layer.mergeAll(
  Layer.unwrap(Effect.map(Deployment.telemetry, Telemetry.layer)).pipe(Layer.provide(FetchHttpClient.layer)),
  Layer.effect(Deployment.SandboxTelemetry, PostHog.variables),
  Layer.unwrap(
    Effect.map(Config.LogLevel("LOG_LEVEL").pipe(Config.withDefault("Info")), (level) =>
      Layer.succeed(References.MinimumLogLevel, level),
    ),
  ),
  Layer.unwrap(Effect.map(Config.LogLevel("TRACE_LEVEL").pipe(Config.withDefault("Info")), Observability.layer)),
)

const queue = Layer.merge(
  PersistedQueue.layer,
  PersistedQueue.layerCleanup({ timeToLive: "1 day", failedTimeToLive: "30 days" }),
).pipe(Layer.provide(PersistedQueue.layerStoreSql()))

Layer.mergeAll(HttpRouter.serve(Routes.layer), EgressRoutes.serve).pipe(
  Layer.provide(IntakeOrigins.layer),
  Layer.provide([
    Layer.mergeAll(
      Layer.mergeAll(Brains.layer, BrainPush.layer, SpaceShutdown.layer).pipe(
        Layer.provideMerge(host),
        Layer.provideMerge(environments),
        Layer.provide(CredentialEnv.layer),
      ),
      Retention.layer,
      RenInferenceRemoval.layer,
      BillingEnrollment.layer.pipe(Layer.provide(Billing.layerConfig)),
    ),
    Layer.mergeAll(
      Layer.mergeAll(ChannelNotice.layer, TaskCard.layer).pipe(
        Layer.provideMerge(Layer.mergeAll(GitHubTaskCard.layer, SlackTaskCard.layer)),
      ),
      ChannelRoute.layer.pipe(Layer.provide(ChannelIdentity.layer)),
    ).pipe(Layer.provideMerge(ChannelProvider.layer(Effect.all([GitHub.provider, Slack.provider])))),
    Mailer.layer,
    SignupGuard.layer,
    TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  ]),
  Layer.provideMerge(credentials),
  Layer.provideMerge(DurableRunner.layerEffect),
  Layer.provideMerge(queue),
  Layer.provide([BrainClient.layer, Settings.layer]),
  Layer.provide([models, GitHubApp.layer, Integrations.layer]),
  Layer.provide(Layer.mergeAll(EgressControl.layerConfig, Signer.layerLocal)),
  Layer.provideMerge(brainProviders),
  Layer.provide(handProviders),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide(PostHog.layer),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(
    BunHttpServer.layerConfig({
      port: Config.Port("PORT").pipe(Config.withDefault(4000)),
      idleTimeout: Config.succeed(10),
    }),
  ),
  Layer.provide(observability),
  Layer.launch,
  BunRuntime.runMain,
)
