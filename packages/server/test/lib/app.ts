import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { BrainProvider } from "@ren/core/brain-provider"
import { SandboxEgress } from "@ren/core/sandbox-egress"
import { MachineNetwork } from "@ren/core/machine-network"
import { Bundles } from "@ren/core/bundles"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { SpaceShutdown } from "@ren/core/space-shutdown"
import { Brains } from "@ren/core/brains"
import { ChannelNotice } from "@ren/core/channel-notice"
import { GitHubApp } from "@ren/core/github-app"
import { SlackTaskCard } from "@ren/core/slack-task-card"
import { TaskCard } from "@ren/core/task-card"
import { GitHubAccounts } from "@ren/core/github-accounts"
import { PersonCredentials } from "@ren/core/person-credentials"
import { ChannelProvider } from "@ren/core/channel-provider"
import { ChannelSecrets } from "@ren/core/channel-secrets"
import { ChannelIdentity } from "@ren/core/channel-identity"
import { ChannelRoute } from "@ren/core/channel-route"
import { Drives } from "@ren/core/drives"
import { Intake } from "@ren/core/intake"
import { Billing } from "@ren/core/billing"
import { BillingEnrollment } from "@ren/core/billing-enrollment"
import { DurableRunner } from "@ren/core/durable-runner"
import { HandProvider } from "@ren/core/hand-provider"
import { Docker } from "@ren/core/machine-provider/docker"
import { Hands } from "@ren/core/hands"
import { ArtifactWorkerd } from "@ren/core/artifact-provider/workerd"
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
import { ClusterWorkflowEngine, SingleRunner } from "effect/cluster"
import { Digest } from "effect/crypto"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { PersistedQueue } from "effect/persistence"
import { Routes } from "../../src/routes.js"
import { Signer } from "@ren/core/signer"
import { SlackApp } from "@ren/core/slack-app"
import { EgressControl } from "@ren/core/egress-control"
import { Access } from "@ren/core/access"
import { Credentials } from "@ren/core/credentials"
import { Envelope } from "@ren/core/envelope"
import { TestDrives } from "@ren/core/testing"
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

const envelopeKeys = JSON.stringify([
  { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
])

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
      ENVELOPE_KEYS: envelopeKeys,
      ...TestDrives.config,
      ...overrides,
    }),
    { asPrimary: true },
  )

export const services = Layer.mergeAll(
  Layer.merge(Brains.layer, SpaceShutdown.layer).pipe(
    Layer.provideMerge(BrainHost.layerCell),
    Layer.provideMerge(
      ClusterWorkflowEngine.layer.pipe(
        Layer.provideMerge(
          SingleRunner.layer({ shardingConfig: { shardsPerGroup: 1, entityTerminationTimeout: "100 millis" } }),
        ),
        Layer.provide(Digest.layerWebCrypto),
      ),
    ),
    Layer.provide(CredentialEnv.layerNone),
  ),
  ChannelRoute.layer.pipe(
    Layer.provide(ChannelIdentity.layer),
    Layer.provideMerge(ChannelProvider.layer(Effect.succeed([]))),
  ),
  Intake.receivers(Effect.succeed([])),
  Intake.workers(Effect.succeed([])),
  PersistedQueue.layer.pipe(Layer.provide(PersistedQueue.layerStoreSql())),
  ChannelNotice.layerLog,
  TaskCard.layerNone,
  SlackTaskCard.layerNone,
  Mailer.layer,
  SignupGuard.layer,
  TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  OAuth.layer,
  RenInferenceRemoval.layer.pipe(Layer.provide(DurableRunner.layerMemory)),
  BillingEnrollment.layer.pipe(Layer.provide(DurableRunner.layerMemory), Layer.provideMerge(Billing.layerNone)),
).pipe(
  Layer.provideMerge(ProviderConnect.layer),
  Layer.provideMerge(AppProfiles.layer),
  Layer.provideMerge([BrainClient.layer, Settings.layer]),
  Layer.provideMerge([
    Models.layerNone,
    Hands.layer.pipe(
      Layer.provide([SandboxEgress.layerNone, MachineNetwork.layerNone, Bundles.layer, DurableRunner.layerMemory]),
    ),
    BrainProvider.layer([]),
  ]),
  Layer.provideMerge(RenInference.layerConfig),
  Layer.provideMerge(SlackApp.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Credentials.layer,
      PersonCredentials.layer,
      ChannelSecrets.layer,
      GitHubAccounts.layerNone,
      GitHubApp.layerNone,
    ),
  ),
  Layer.provideMerge(Drives.layer),
  Layer.provideMerge(Layer.mergeAll(Envelope.layerLocal, Access.layer, OAuthFetch.layerUnchecked)),
  Layer.provideMerge(EgressControl.layerNone),
  Layer.provideMerge(HandProvider.layer([Docker.provider])),
  Layer.provideMerge(Signer.layerLocal),
  Layer.provideMerge(ArtifactWorkerd.layer.pipe(Layer.provide(FetchHttpClient.layer))),
  Layer.provide(BunServices.layer),
)

export const makeApp = (
  routes: Layer.Layer<
    Layer.Success<typeof Routes.layer>,
    Layer.Error<typeof Routes.layer>,
    Layer.Services<typeof Routes.layer> | Layer.Success<typeof services>
  > = Routes.layer,
  options?: {
    readonly baseURL?: string
    readonly config?: Readonly<Record<string, string>>
    readonly logs?: Array<string>
    readonly database?: typeof Testing.layer
    readonly observability?: Layer.Layer<never>
  },
) =>
  HttpRouter.toWebHandler(
    routes.pipe(
      Layer.provide(options?.observability ?? Layer.empty),
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
