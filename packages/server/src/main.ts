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
import { DurableRunner } from "@ren/core/durable-runner"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Docker } from "@ren/core/environment-provider/docker"
import { Environments } from "@ren/core/environments"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
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
    return BrainHost.layerSandbox.pipe(
      Layer.provide(BrainLifecycle.layer.pipe(Layer.provide(SandboxEgress.layerConfig))),
      Layer.provide(provider === "e2b" ? E2BSandbox.layer : LocalSandbox.layer({ entry, executor, root })),
    )
  }),
)

// oxlint-disable-next-line ren/no-comments -- HR28: with REN_LITELLM_URL, the picker and the brains read LiteLLM; REN_MODELS_FILE stays for a local run without it.
const models = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.option(Config.String("REN_LITELLM_URL"))
    return Option.isSome(url) ? Models.layerLiteLLM.pipe(Layer.provide(FetchHttpClient.layer)) : Models.layerConfig
  }),
)

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
  Layer.provideMerge(Layer.mergeAll(Envelope.layerLocal, Access.layer, OAuthFetch.layerPublic)),
)

Layer.mergeAll(HttpRouter.serve(Routes.layer), EgressRoutes.serve).pipe(
  Layer.provide([
    Layer.mergeAll(
      Layer.mergeAll(Brains.layer, BrainPush.layer).pipe(Layer.provide(host), Layer.provide(CredentialEnv.layer)),
      Retention.layer,
    ),
    Mailer.layer,
    SignupGuard.layer,
    TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  ]),
  Layer.provideMerge(credentials),
  Layer.provideMerge(DurableRunner.layerEffect),
  Layer.provide([BrainClient.layer, Settings.layer]),
  Layer.provide([models, Environments.layer]),
  Layer.provide(Layer.mergeAll(EgressControl.layerConfig, Signer.layerLocal)),
  Layer.provide(EnvironmentProvider.layer([Docker.provider])),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
