import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Access } from "@ren/core/access"
import { CredentialCallers } from "@ren/core/credential-callers"
import { CredentialRefresh } from "@ren/core/credential-refresh"
import { CredentialSource } from "@ren/core/credential-source"
import { CredentialEnv } from "@ren/core/credential-env"
import { Credentials } from "@ren/core/credentials"
import { Egress } from "@ren/core/egress"
import { OAuth } from "@ren/core/oauth"
import { OAuthFetch } from "@ren/core/oauth-fetch"
import { McpProvider } from "@ren/core/mcp-provider"
import { ProviderConnect } from "@ren/core/mcp-provider/connect"
import { AppProfiles } from "@ren/core/app/profiles"
import { Envelope } from "@ren/core/envelope"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { BrainPush } from "@ren/core/brain-push"
import { BrainLifecycle } from "@ren/core/brain-lifecycle"
import { Brains } from "@ren/core/brains"
import { ChannelNotice } from "@ren/core/channel-notice"
import { ChannelProvider } from "@ren/core/channel-provider"
import { GitHub } from "@ren/core/channel-provider/github"
import { GitHubApp } from "@ren/core/github-app"
import { ChannelRoute } from "@ren/core/channel-route"
import { DurableRunner } from "@ren/core/durable-runner"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Docker } from "@ren/core/environment-provider/docker"
import { Environments } from "@ren/core/environments"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
import { RenInference } from "@ren/core/ren-inference"
import { RenInferenceRemoval } from "@ren/core/ren-inference-removal"
import { Retention } from "@ren/core/retention"
import { SandboxEgress } from "@ren/core/sandbox-egress"
import { E2BSandbox } from "@ren/core/sandbox-provider/e2b"
import { LocalSandbox } from "@ren/core/sandbox-provider/local"
import { Settings } from "@ren/core/settings"
import { SignupGuard } from "@ren/core/signup-guard"
import { TranscriptCodec } from "@ren/core/transcript-codec"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Config, Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { EgressRoutes } from "./egress.js"
import { Routes } from "./routes.js"
import { Signer } from "@ren/core/signer"
import { EgressControl } from "@ren/core/egress-control"

const host = Layer.unwrap(
  Effect.gen(function* () {
    const provider = yield* Config.Literals(["local", "e2b", "cell"], "SANDBOX_PROVIDER").pipe(
      Config.withDefault("local"),
    )
    if (provider === "cell") return BrainHost.layerCell
    const root = yield* Config.String("LOCAL_BRAIN_ROOT").pipe(Config.withDefault(join(tmpdir(), "ren-brains")))
    const entry = yield* Config.String("LOCAL_BRAIN_ENTRY").pipe(
      Config.withDefault(join(import.meta.dir, "../../cell/src/bun.ts")),
    )
    const executor = yield* Config.String("LOCAL_EXECUTOR_ENTRY").pipe(
      Config.withDefault(join(import.meta.dir, "../../executor/src/main.ts")),
    )
    const owner = yield* Config.option(Config.Int("LOCAL_BRAIN_OWNER"))
    return BrainHost.layerSandbox.pipe(
      Layer.provide(
        BrainLifecycle.layer.pipe(
          // oxlint-disable-next-line ren/no-comments -- An E2B brain without the egress would fetch the real model key, and in e2b-space the agent's code runs in the same sandbox, so the server does not start without EGRESS_PROXY_ADDRESS.
          Layer.provide(provider === "e2b" ? SandboxEgress.layer : SandboxEgress.layerConfig),
        ),
      ),
      Layer.provide(
        provider === "e2b"
          ? E2BSandbox.layer
          : LocalSandbox.layer({
              entry,
              executor,
              root,
              ...Option.match(owner, { onNone: () => ({}), onSome: (pid) => ({ owner: pid }) }),
            }),
      ),
    )
  }),
)

// oxlint-disable-next-line ren/no-comments -- HR28, F2: the picker and the brains read the model list from LiteLLM: through the Ren Inference Service when REN_INFERENCE_URL is set, else REN_LITELLM_URL; a local run uses LiteLLM or its stub.
const models = Layer.unwrap(
  Effect.map(Config.option(Config.String("REN_INFERENCE_URL")), (url) =>
    Option.isSome(url) ? Models.layerRenInference : Models.layerLiteLLM.pipe(Layer.provide(FetchHttpClient.layer)),
  ),
).pipe(Layer.provideMerge(RenInference.layerConfig), Layer.provide(Access.layer))

// oxlint-disable-next-line ren/no-comments -- Every stored credential is sealed with ENVELOPE_KEYS; without a key the server would start and then refuse each credential save, so it does not start.
const envelope = Layer.unwrap(Effect.as(Config.Redacted("ENVELOPE_KEYS"), Envelope.layerLocal))

const credentials = Layer.mergeAll(Egress.layer, OAuth.layer).pipe(
  Layer.provideMerge(ProviderConnect.layer),
  Layer.provideMerge(
    CredentialRefresh.layer.pipe(Layer.provide(ProviderConnect.layerRefresher), Layer.provide(OAuth.layerRefresher)),
  ),
  Layer.provideMerge(AppProfiles.layer),
  Layer.provideMerge(CredentialSource.layer),
  Layer.provideMerge(
    Layer.mergeAll(CredentialSource.layerStatic, CredentialSource.layerMinted, CredentialSource.layerProvider),
  ),
  Layer.provideMerge(Layer.mergeAll(Credentials.layer, CredentialCallers.layer)),
  Layer.provideMerge(McpProvider.layerCleanup),
  Layer.provideMerge(McpProvider.layer([McpProvider.composio])),
  Layer.provideMerge(Layer.mergeAll(envelope, Access.layer, OAuthFetch.layerPublic)),
)

Layer.mergeAll(HttpRouter.serve(Routes.layer), EgressRoutes.serve).pipe(
  Layer.provide([
    Layer.mergeAll(
      Layer.mergeAll(Brains.layer, BrainPush.layer).pipe(Layer.provideMerge(host), Layer.provide(CredentialEnv.layer)),
      Retention.layer,
      RenInferenceRemoval.layer,
    ),
    ChannelNotice.layer.pipe(Layer.provideMerge(ChannelProvider.layer([GitHub.provider]))),
    ChannelRoute.layer,
    Mailer.layer,
    SignupGuard.layer,
    TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  ]),
  Layer.provideMerge(credentials),
  Layer.provideMerge(DurableRunner.layerEffect),
  Layer.provide([BrainClient.layer, Settings.layer]),
  Layer.provide([models, Environments.layer, GitHubApp.layer]),
  Layer.provide(Layer.mergeAll(EgressControl.layerConfig, Signer.layerLocal)),
  Layer.provide(EnvironmentProvider.layer([Docker.provider])),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
