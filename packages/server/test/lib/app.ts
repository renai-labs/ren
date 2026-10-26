import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { Brains } from "@ren/core/brains"
import { ChannelNotice } from "@ren/core/channel-notice"
import { GitHubAccounts } from "@ren/core/github-accounts"
import { PersonCredentials } from "@ren/core/person-credentials"
import { ChannelProvider } from "@ren/core/channel-provider"
import { ChannelIdentity } from "@ren/core/channel-identity"
import { ChannelRoute } from "@ren/core/channel-route"
import { DurableRunner } from "@ren/core/durable-runner"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Docker } from "@ren/core/environment-provider/docker"
import { Environments } from "@ren/core/environments"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
import { RenInference } from "@ren/core/ren-inference"
import { RenInferenceRemoval } from "@ren/core/ren-inference-removal"
import { Settings } from "@ren/core/settings"
import { SignupGuard } from "@ren/core/signup-guard"
import { TranscriptCodec } from "@ren/core/transcript-codec"
import { Testing } from "@ren/db/testing"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { BrainToken } from "@ren/host-api/brain-token"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { Clock, ConfigProvider, Effect, Layer, Logger, Schema } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Routes } from "../../src/routes.js"
import { Signer } from "@ren/core/signer"
import { EgressControl } from "@ren/core/egress-control"
import { Access } from "@ren/core/access"
import { Credentials } from "@ren/core/credentials"
import { Envelope } from "@ren/core/envelope"
import { CredentialEnv } from "@ren/core/credential-env"
import { OAuth } from "@ren/core/oauth"
import { OAuthFetch } from "@ren/core/oauth-fetch"
import { AppProfiles } from "@ren/core/app/profiles"
import { ProviderConnect } from "@ren/core/mcp-provider/connect"

export const origin = "http://localhost:5173"

export const brainKey = await Effect.runPromise(Signature.generate("test"))

const brainKeys = JSON.stringify([
  { id: brainKey.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(brainKey.privateKey.key) },
])

export const sign = (claims: Parameters<typeof BrainToken.sign>[1], key = brainKey.privateKey) =>
  BrainToken.sign(key, claims)

export const hostToken = Effect.fnUntraced(function* (
  brainId: Brain.ID,
  organizationId: Auth.OrganizationID,
  fields: { readonly gen?: number; readonly exp?: number } = {},
) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  return yield* sign({
    scope: "host",
    brain: brainId,
    gen: fields.gen ?? 1,
    org: organizationId,
    iat: now,
    exp: fields.exp ?? now + 600,
  })
})

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
      BRAIN_KEYS: brainKeys,
      ...overrides,
    }),
    { asPrimary: true },
  )

export const services = Layer.mergeAll(
  Brains.layer.pipe(
    Layer.provideMerge(BrainHost.layerCell),
    Layer.provideMerge(DurableRunner.layerMemory),
    Layer.provide(CredentialEnv.layerNone),
  ),
  ChannelRoute.layer.pipe(
    Layer.provide(ChannelIdentity.layer),
    Layer.provideMerge(ChannelProvider.layer<never, never>([])),
  ),
  ChannelNotice.layerLog,
  Mailer.layer,
  SignupGuard.layer,
  TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  OAuth.layer,
  RenInferenceRemoval.layer.pipe(Layer.provide(DurableRunner.layerMemory)),
).pipe(
  Layer.provideMerge(ProviderConnect.layer),
  Layer.provideMerge(AppProfiles.layer),
  Layer.provideMerge([BrainClient.layer.pipe(Layer.provide(Signer.layerLocal)), Settings.layer]),
  Layer.provideMerge([Models.layerNone, Environments.layer.pipe(Layer.provide(Signer.layerLocal))]),
  Layer.provideMerge(RenInference.layerConfig.pipe(Layer.provide(Signer.layerLocal))),
  Layer.provideMerge(Layer.mergeAll(Credentials.layer, PersonCredentials.layer, GitHubAccounts.layerNone)),
  Layer.provideMerge(Layer.mergeAll(Envelope.layerLocal, Access.layer, OAuthFetch.layerUnchecked)),
  Layer.provideMerge(EgressControl.layerNone),
  Layer.provideMerge(EnvironmentProvider.layer([Docker.provider])),
  Layer.provide(BunServices.layer),
)

export const makeApp = (
  routes: typeof Routes.layer = Routes.layer,
  options?: {
    readonly baseURL?: string
    readonly config?: Readonly<Record<string, string>>
    readonly logs?: Array<string>
    readonly database?: typeof Testing.layer
  },
) =>
  HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide(services),
      Layer.provide(options?.database ?? Testing.layer),
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

export const call = (
  app: { readonly handler: (request: Request) => Promise<Response> },
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
) =>
  app.handler(
    new Request(`http://localhost:4000${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  )

export const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
