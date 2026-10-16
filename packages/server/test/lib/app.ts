import { BunHttpServer } from "@effect/platform-bun"
import { BrainHost } from "@ren/core/brain-host"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
import { SignupGuard } from "@ren/core/signup-guard"
import { Testing } from "@ren/db/testing"
import { ConfigProvider, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Routes } from "../../src/routes.js"

export const origin = "http://localhost:5173"

export const makeApp = (routes: typeof Routes.layer = Routes.layer, options?: { readonly baseURL?: string }) =>
  HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide([BrainHost.layer, Mailer.layer, SignupGuard.layer]),
      Layer.provide(Models.layerNone),
      Layer.provide(Testing.layer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(BunHttpServer.layerHttpServices),
      Layer.provide(
        ConfigProvider.layerAdd(
          ConfigProvider.fromUnknown({
            BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
            BETTER_AUTH_URL: options?.baseURL ?? "http://localhost:4000",
            TRUSTED_ORIGINS: origin,
            GOOGLE_CLIENT_ID: "google-client-id",
            GOOGLE_CLIENT_SECRET: "google-client-secret",
            APP_URL: `${origin}/app`,
            SKIP_EMAIL_VERIFICATION: "true",
            SIGNUP_MX_CHECK: "false",
            CELL_URL: "http://127.0.0.1:9",
            CELL_KEYS: JSON.stringify([{ id: "test", secret: "a-test-cell-key-of-at-least-32-characters" }]),
          }),
          { asPrimary: true },
        ),
      ),
    ),
    { disableLogger: true },
  )

export const authRequest = (path: string, body: unknown, cookie = "") =>
  new Request(`http://localhost:4000/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:4000", cookie },
    body: JSON.stringify(body),
  })

export const signUp = (app: ReturnType<typeof makeApp>, email: string, name = "Ada") =>
  app.handler(authRequest("/sign-up/email", { email, password: "correct horse battery staple", name }))

export const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
