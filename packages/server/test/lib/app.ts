import { BunHttpServer } from "@effect/platform-bun"
import { Mailer } from "@ren/core/mailer"
import { Testing } from "@ren/db/testing"
import { ConfigProvider, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Routes } from "../../src/routes.js"

export const origin = "http://localhost:5173"

export const makeApp = (routes: typeof Routes.layer = Routes.layer) =>
  HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide([Testing.layer, Mailer.layer]),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(BunHttpServer.layerHttpServices),
      Layer.provide(
        ConfigProvider.layerAdd(
          ConfigProvider.fromUnknown({
            BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
            BETTER_AUTH_URL: "http://localhost:4000",
            TRUSTED_ORIGINS: origin,
            GOOGLE_CLIENT_ID: "google-client-id",
            GOOGLE_CLIENT_SECRET: "google-client-secret",
            APP_URL: origin,
          }),
          { asPrimary: true },
        ),
      ),
    ),
    { disableLogger: true },
  )
