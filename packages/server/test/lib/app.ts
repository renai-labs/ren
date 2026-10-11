import { BunHttpServer } from "@effect/platform-bun"
import { Testing } from "@ren/db/testing"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { Routes } from "../../src/routes.js"

export const origin = "http://localhost:5173"

export const makeApp = () =>
  HttpRouter.toWebHandler(
    Routes.layer.pipe(
      Layer.provide(Testing.layer),
      Layer.provide(BunHttpServer.layerHttpServices),
      Layer.provide(
        ConfigProvider.layerAdd(
          ConfigProvider.fromUnknown({
            BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
            BETTER_AUTH_URL: "http://localhost:4000",
            TRUSTED_ORIGINS: origin,
          }),
          { asPrimary: true },
        ),
      ),
    ),
    { disableLogger: true },
  )
