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

HttpRouter.serve(Routes.layer).pipe(
  Layer.provide([
    Brains.layer.pipe(Layer.provide(BrainHost.layerCell), Layer.provide(DurableRunner.layerEffect)),
    Mailer.layer,
    SignupGuard.layer,
    TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  ]),
  Layer.provide([BrainClient.layer.pipe(Layer.provide(Signer.layerLocal)), Settings.layer]),
  Layer.provide([ChaosModels.layer, Environments.layer.pipe(Layer.provide(Signer.layerLocal))]),
  Layer.provide(EgressControl.layerNone),
  Layer.provide(EnvironmentProvider.layer(ChaosEnvironments.providers)),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
