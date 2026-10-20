import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { BrainHost } from "@ren/core/brain-host"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Docker } from "@ren/core/environment-provider/docker"
import { Environments } from "@ren/core/environments"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
import { SignupGuard } from "@ren/core/signup-guard"
import { Testing } from "@ren/db/testing"
import { ConfigProvider, Layer, Logger } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Routes } from "../../src/routes.js"

export const origin = "http://localhost:5173"

export const cellKey = { id: "test", secret: "a-test-cell-key-of-at-least-32-characters" }

export const config = {
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:4000",
  TRUSTED_ORIGINS: origin,
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  APP_URL: `${origin}/app`,
}

export const environment = (baseURL = config.BETTER_AUTH_URL, overrides?: Readonly<Record<string, string>>) =>
  ConfigProvider.layerAdd(
    ConfigProvider.fromUnknown({
      ...config,
      BETTER_AUTH_URL: baseURL,
      SKIP_EMAIL_VERIFICATION: "true",
      SIGNUP_MX_CHECK: "false",
      CELL_URL: "http://127.0.0.1:9",
      CELL_KEYS: JSON.stringify([cellKey]),
      ...overrides,
    }),
    { asPrimary: true },
  )

export const services = Layer.mergeAll(BrainHost.layer, Mailer.layer, SignupGuard.layer).pipe(
  Layer.provideMerge([Models.layerNone, Environments.layer]),
  Layer.provideMerge(EnvironmentProvider.layer([Docker.provider])),
  Layer.provide(BunServices.layer),
)

export const makeApp = (
  routes: typeof Routes.layer = Routes.layer,
  options?: {
    readonly baseURL?: string
    readonly config?: Readonly<Record<string, string>>
    readonly logs?: Array<string>
  },
) =>
  HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide(services),
      Layer.provide(Testing.layer),
      Layer.provide([FetchHttpClient.layer, BunServices.layer]),
      Layer.provide(BunHttpServer.layerHttpServices),
      Layer.provideMerge(
        options?.logs
          ? Logger.layer([Logger.make((log) => options.logs?.push(Logger.formatJson.log(log)))])
          : Layer.empty,
      ),
      Layer.provide(environment(options?.baseURL, options?.config)),
    ),
    { disableLogger: !options?.logs },
  )

export const authRequest = (path: string, body: unknown, cookie = "", baseURL = "http://localhost:4000") =>
  new Request(`${baseURL}/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL, cookie },
    body: JSON.stringify(body),
  })

export const signUp = (
  app: { readonly handler: (request: Request) => Promise<Response> },
  email: string,
  name = "Ada",
  baseURL?: string,
) => app.handler(authRequest("/sign-up/email", { email, password: "correct horse battery staple", name }, "", baseURL))

export const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
