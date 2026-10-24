import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { Brains } from "@ren/core/brains"
import { DurableRunner } from "@ren/core/durable-runner"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Environments } from "@ren/core/environments"
import { Mailer } from "@ren/core/mailer"
import { Settings } from "@ren/core/settings"
import { SignupGuard } from "@ren/core/signup-guard"
import { TranscriptCodec } from "@ren/core/transcript-codec"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Routes } from "@ren/server/routes"
import { Config, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { ChaosEnvironments } from "./provider/environments.js"
import { ChaosModels } from "./provider/models.js"
import { Signer } from "@ren/core/signer"
import { EgressControl } from "@ren/core/egress-control"
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
  Layer.provideMerge(AppProfiles.layer),
  Layer.provideMerge(Layer.mergeAll(Credentials.layer, CredentialCallers.layer)),
  Layer.provideMerge(Layer.mergeAll(Envelope.layerLocal, Access.layer, OAuthFetch.layerPublic)),
)

HttpRouter.serve(Routes.layer).pipe(
  Layer.provide([
    Brains.layer.pipe(
      Layer.provide(BrainHost.layerCell),
      Layer.provide(DurableRunner.layerEffect),
      Layer.provide(CredentialEnv.layerNone),
    ),
    Mailer.layer,
    SignupGuard.layer,
    TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  ]),
  Layer.provideMerge(credentials),
  Layer.provideMerge(DurableRunner.layerEffect),
  Layer.provide([BrainClient.layer, Settings.layer]),
  Layer.provide([ChaosModels.layer, Environments.layer.pipe(Layer.provide(Signer.layerLocal))]),
  Layer.provide(Layer.mergeAll(EgressControl.layerNone, Signer.layerLocal)),
  Layer.provide(EnvironmentProvider.layer(ChaosEnvironments.providers)),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
