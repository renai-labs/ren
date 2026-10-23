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
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { Routes } from "@ren/server/routes"
import { Config, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { ChaosEnvironments } from "./provider/environments.js"
import { ChaosModels } from "./provider/models.js"

HttpRouter.serve(Routes.layer).pipe(
  Layer.provide([
    Brains.layer.pipe(Layer.provide(BrainHost.layerCell), Layer.provide(DurableRunner.layerEffect)),
    Mailer.layer,
    SignupGuard.layer,
  ]),
  Layer.provide([BrainClient.layer, Settings.layer]),
  Layer.provide([ChaosModels.layer, Environments.layer]),
  Layer.provide(EnvironmentProvider.layer(ChaosEnvironments.providers)),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
