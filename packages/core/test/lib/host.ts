export * as Host from "./host.js"

import { BunCrypto } from "@effect/platform-bun"
import { TestEnvironment } from "@ren/executor/testing"
import type { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, type Duration, Effect, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainClient } from "../../src/brain-client.js"
import { BrainHost } from "../../src/brain-host.js"
import { BrainLifecycle } from "../../src/brain-lifecycle.js"
import { DurableRunner } from "../../src/durable-runner.js"
import { EnvironmentProvider } from "../../src/environment-provider.js"
import { Environments } from "../../src/environments.js"
import type { Models } from "../../src/models.js"
import { SandboxProvider } from "../../src/sandbox-provider.js"
import { LocalSandbox } from "../../src/sandbox-provider/local.js"
import { Settings } from "../../src/settings.js"
import { RenHostApiTest } from "./ren-host-api.js"
import { Seed } from "./seed.js"

const entry = join(import.meta.dir, "../../../cell/src/bun.ts")
const executor = join(import.meta.dir, "../../../executor/src/main.ts")

export const keys = [await Effect.runPromise(Signature.generate("test"))] as const

const brainKeys = JSON.stringify(
  keys.map((key) => ({
    id: key.privateKey.id,
    key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key),
  })),
)

const environmentKeys = JSON.stringify([
  {
    id: TestEnvironment.keys.privateKey.id,
    key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(TestEnvironment.keys.privateKey.key),
  },
])

export const noTemplates = Environments.layer.pipe(Layer.provide(EnvironmentProvider.layer<never, never>([])))

export const freePort = Effect.promise(async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port ?? 0
  await probe.stop(true)
  return port
})

interface StackOptions<E, R> {
  readonly port: number
  readonly root: string
  readonly config: Record<string, string>
  readonly models: Layer.Layer<Models.Service>
  readonly environments: Layer.Layer<Environments.Service, E, R>
  readonly lostEvery?: Duration.Input
}

// oxlint-disable-next-line ren/no-comments -- Each brain is a real Bun brain process on this machine (LocalSandbox), under root. Brains reach Ren on REN_URL, where serve answers.
export const stack = <E, R>(options: StackOptions<E, R>) =>
  BrainHost.layerSandbox.pipe(
    Layer.provideMerge(BrainLifecycle.layer),
    Layer.provideMerge(
      LocalSandbox.layer({
        entry,
        executor,
        root: options.root,
        ...(options.lostEvery && { lostEvery: options.lostEvery }),
      }),
    ),
    Layer.provideMerge(DurableRunner.layerEffect.pipe(Layer.provide(BunCrypto.layer))),
    Layer.provideMerge(BrainClient.layer),
    Layer.provide(Settings.layer),
    Layer.provide(options.models),
    Layer.provide(options.environments),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BRAIN_KEYS: brainKeys,
          ENVIRONMENT_KEYS: environmentKeys,
          REN_URL: `http://127.0.0.1:${options.port}`,
          ...options.config,
        }),
      ),
    ),
  )

// oxlint-disable-next-line ren/no-comments -- The Ren Host API of the BrainHost in context, on port. A test stops it to take Ren down for the brains while it still calls BrainHost itself.
export const serve = (port: number, around?: RenHostApiTest.Around) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<BrainHost.Service>()
      const api = HttpRouter.toWebHandler(
        RenHostApiTest.layer(around).pipe(
          Layer.provide(Layer.succeedContext(context)),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true },
      )
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, fetch: (request) => api.handler(request) }),
        ),
        (server) =>
          Effect.promise(async () => {
            await server.stop(true)
            await api.dispose()
          }),
      )
    }),
  )

export const destroyBrains = Layer.effectDiscard(
  Effect.gen(function* () {
    const provider = yield* SandboxProvider.Service
    yield* Effect.addFinalizer(() =>
      provider.list.pipe(
        Effect.flatMap((all) => Effect.forEach(all, (each) => provider.destroy(each.binding).pipe(Effect.ignore))),
        Effect.ignore,
      ),
    )
  }),
)

const root = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "ren-core-brains-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
)

export const layerWith = <E, R>(
  config: Record<string, string>,
  models: Layer.Layer<Models.Service>,
  environments: Layer.Layer<Environments.Service, E, R>,
  around?: RenHostApiTest.Around,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const found = yield* freePort
      return Layer.mergeAll(serve(found, around), destroyBrains, Layer.effectDiscard(Seed.ren())).pipe(
        Layer.provideMerge(stack({ port: found, root: yield* root, config, models, environments })),
      )
    }),
  )

export const layer = (config: Record<string, string>, models: Layer.Layer<Models.Service>) =>
  layerWith(config, models, noTemplates)

// oxlint-disable-next-line ren/no-comments -- BrainHost.layer reaches every brain at CELL_URL, so a test can put a server that fails on purpose there.
export const cellLayer = <E, R>(
  config: Record<string, string>,
  models: Layer.Layer<Models.Service>,
  environments: Layer.Layer<Environments.Service, E, R>,
) =>
  Layer.fresh(BrainHost.layer).pipe(
    Layer.provideMerge(BrainClient.layer),
    Layer.provide(Settings.layer),
    Layer.provide(models),
    Layer.provide(environments),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ BRAIN_KEYS: brainKeys, ENVIRONMENT_KEYS: environmentKeys, ...config }),
      ),
    ),
  )

export const ready = <E, R>(access: Effect.Effect<Session.ClientAccess, E, R>) =>
  access.pipe(
    Effect.flatMap((found) =>
      found.status === "ready" ? Effect.succeed(found) : Effect.fail(new Error(`The brain is ${found.status}`)),
    ),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 300 }),
    Effect.orDie,
  )
