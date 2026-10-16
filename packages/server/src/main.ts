import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { BrainHost } from "@ren/core/brain-host"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
import { SignupGuard } from "@ren/core/signup-guard"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { Config, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Routes } from "./routes.js"

HttpRouter.serve(Routes.layer).pipe(
  Layer.provide([BrainHost.layer, Mailer.layer, SignupGuard.layer]),
  Layer.provide(Models.layerNone),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, Postgres.layer]),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
