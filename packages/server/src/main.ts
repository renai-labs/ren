import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Mailer } from "@ren/core/mailer"
import { SignupGuard } from "@ren/core/signup-guard"
import { AuthDatabase } from "@ren/db/auth-database"
import { Config, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Routes } from "./routes.js"

HttpRouter.serve(Routes.layer).pipe(
  Layer.provide([Mailer.layer, SignupGuard.layer]),
  Layer.provide(AuthDatabase.layer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
