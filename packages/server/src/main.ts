import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { BrainLifecycle } from "@ren/core/brain-lifecycle"
import { Brains } from "@ren/core/brains"
import { DurableRunner } from "@ren/core/durable-runner"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Docker } from "@ren/core/environment-provider/docker"
import { Environments } from "@ren/core/environments"
import { Mailer } from "@ren/core/mailer"
import { Models } from "@ren/core/models"
import { Retention } from "@ren/core/retention"
import { E2BSandbox } from "@ren/core/sandbox-provider/e2b"
import { LocalSandbox } from "@ren/core/sandbox-provider/local"
import { Settings } from "@ren/core/settings"
import { SignupGuard } from "@ren/core/signup-guard"
import { TranscriptCodec } from "@ren/core/transcript-codec"
import { AuthDatabase } from "@ren/db/auth-database"
import { Database } from "@ren/db/database"
import { Postgres } from "@ren/db/postgres"
import { OpenCodeTranscript } from "@ren/opencode-transcript/transcript"
import { Config, Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { join } from "node:path"
import { tmpdir } from "node:os"
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
      Layer.provide(BrainLifecycle.layer),
      Layer.provide(provider === "e2b" ? E2BSandbox.layer : LocalSandbox.layer({ entry, executor, root })),
    )
  }),
)

HttpRouter.serve(Routes.layer).pipe(
  Layer.provide([
    Layer.mergeAll(Brains.layer.pipe(Layer.provide(host)), Retention.layer).pipe(
      Layer.provide(DurableRunner.layerEffect),
    ),
    Mailer.layer,
    SignupGuard.layer,
    TranscriptCodec.layer({ opencode: { messages: OpenCodeTranscript.messages } }),
  ]),
  Layer.provide([BrainClient.layer.pipe(Layer.provide(Signer.layerLocal)), Settings.layer]),
  Layer.provide([Models.layerConfig, Environments.layer.pipe(Layer.provide(Signer.layerLocal))]),
  Layer.provide(EgressControl.layerConfig),
  Layer.provide(EnvironmentProvider.layer([Docker.provider])),
  Layer.provide([AuthDatabase.layer, Database.layer]),
  Layer.provide([FetchHttpClient.layer, BunServices.layer, Postgres.layer]),
  Layer.provide(BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(4000)) })),
  Layer.launch,
  BunRuntime.runMain,
)
