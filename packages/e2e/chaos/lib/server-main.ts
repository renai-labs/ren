import { HandProvider } from "@ren/core/hand-provider"
import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { BrainProvider } from "@ren/core/brain-provider"
import { SandboxEgress } from "@ren/core/sandbox-egress"
import { MachineNetwork } from "@ren/core/machine-network"
import { Bundles } from "@ren/core/bundles"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { Brains } from "@ren/core/brains"
import { BrainPush } from "@ren/core/brain-push"
import { SpaceShutdown } from "@ren/core/space-shutdown"
import { ChannelNotice } from "@ren/core/channel-notice"
import { ChannelProvider } from "@ren/core/channel-provider"
import { Intake } from "@ren/core/intake"
import { ChannelSecrets } from "@ren/core/channel-secrets"
import { ChannelIdentity } from "@ren/core/channel-identity"
import { ChannelRoute } from "@ren/core/channel-route"
import { Drives } from "@ren/core/drives"
import { Integrations } from "@ren/core/integrations"
import { Billing } from "@ren/core/billing"
import { BillingEnrollment } from "@ren/core/billing-enrollment"
import { DurableRunner } from "@ren/core/durable-runner"
import { Hands } from "@ren/core/hands"
import { ArtifactWorkerd } from "@ren/core/artifact-provider/workerd"
import { Mailer } from "@ren/core/mailer"
import { RenInference } from "@ren/core/ren-inference"
import { RenInferenceRemoval } from "@ren/core/ren-inference-removal"
import { Settings } from "@ren/core/settings"
import { SignupGuard } from "@ren/core/signup-guard"
import { TranscriptCodec } from "@ren/core/transcript-codec"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Routes } from "@ren/server/routes"
import { Config, Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { PersistedQueue } from "effect/persistence"
import { ChaosHands } from "./provider/hands.js"
import { ChaosModels } from "./provider/models.js"
import { Signer } from "@ren/core/signer"
import { EgressControl } from "@ren/core/egress-control"
import { GitHubAccounts } from "@ren/core/github-accounts"
import { GitHubApp } from "@ren/core/github-app"
import { SlackTaskCard } from "@ren/core/slack-task-card"
import { TaskCard } from "@ren/core/task-card"
import { SlackApp } from "@ren/core/slack-app"
import { PersonCredentials } from "@ren/core/person-credentials"
import { CredentialEnv } from "@ren/core/credential-env"
import { Access } from "@ren/core/access"
import { CredentialCallers } from "@ren/core/credential-callers"
import { CredentialSource } from "@ren/core/credential-source"
import { Credentials } from "@ren/core/credentials"
import { Egress } from "@ren/core/egress"
import { Envelope } from "@ren/core/envelope"
import { CredentialRefresh } from "@ren/core/credential-refresh"
import { AppProfiles } from "@ren/core/app/profiles"
import { ProviderConnect } from "@ren/core/mcp-provider/connect"
import { OAuth } from "@ren/core/oauth"
import { OAuthFetch } from "@ren/core/oauth-fetch"

const credentials = Layer.mergeAll(Egress.layer, OAuth.layer).pipe(
  Layer.provideMerge(ProviderConnect.layer),
  Layer.provideMerge(CredentialRefresh.layer.pipe(Layer.provide(OAuth.layerRefresher))),
  Layer.provideMerge(CredentialSource.layer),
  Layer.provideMerge(
    Layer.mergeAll(CredentialSource.layerStatic, CredentialSource.layerMinted, CredentialSource.layerProvider),
  ),
  Layer.provideMerge(Drives.layer),
  Layer.provideMerge(AppProfiles.layer),
  Layer.provideMerge(
    Layer.mergeAll(Credentials.layer, CredentialCallers.layer, PersonCredentials.layer, ChannelSecrets.layer),
  ),
  Layer.provideMerge(GitHubAccounts.layerNone),
  Layer.provideMerge(Layer.mergeAll(Envelope.layerLocal, Access.layer, OAuthFetch.layerPublic)),
)

HttpRouter.serve(Routes.layer).pipe(
  Layer.provide([
    Layer.mergeAll(Brains.layer, BrainPush.layer, SpaceShutdown.layer).pipe(
      Layer.provideMerge(BrainHost.layerCell),
      Layer.provide(DurableRunner.layerEffect),
      Layer.provide(CredentialEnv.layerNone),
    ),
    RenInferenceRemoval.layer,
    BillingEnrollment.layer.pipe(Layer.provideMerge(Billing.layerNone)),
    ChannelRoute.layer.pipe(
      Layer.provide(ChannelIdentity.layer),
      Layer.provideMerge(ChannelProvider.layer(Effect.succeed([]))),
    ),
    Intake.receivers(Effect.succeed([])),
    Intake.workers(Effect.succeed([])),
    ChannelNotice.layerLog,
    TaskCard.layerNone,
    SlackTaskCard.layerNone,
    Mailer.layer,
    SignupGuard.layer,
    TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  ]),
  Layer.provideMerge(credentials),
  Layer.provideMerge(DurableRunner.layerEffect),
  Layer.provideMerge(PersistedQueue.layer.pipe(Layer.provide(PersistedQueue.layerStoreSql()))),
  Layer.provide([BrainClient.layer, Settings.layer]),
  Layer.provide([
    ChaosModels.layer,
    RenInference.layerConfig.pipe(Layer.provide([Signer.layerLocal, Access.layer])),
    Hands.layer.pipe(
      Layer.provide([SandboxEgress.layerNone, MachineNetwork.layerNone, Bundles.layer, DurableRunner.layerMemory]),
      Layer.provide([Signer.layerLocal, FetchHttpClient.layer]),
    ),
    BrainProvider.layer([]),
    Integrations.layer.pipe(Layer.provide(Signer.layerLocal)),
  ]),
  Layer.provide(Layer.mergeAll(EgressControl.layerNone, Signer.layerLocal, GitHubApp.layerNone, SlackApp.layerNone)),
  Layer.provide([HandProvider.layer(ChaosHands.providers), ArtifactWorkerd.layer]),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(
    BunHttpServer.layerConfig({
      port: Config.Port("PORT").pipe(Config.withDefault(4000)),
      idleTimeout: Config.succeed(10),
    }),
  ),
  Layer.launch,
  BunRuntime.runMain,
)
