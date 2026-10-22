export * as Host from "./host.js"

import type { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainClient } from "../../src/brain-client.js"
import { BrainHost } from "../../src/brain-host.js"
import { BrainLifecycle } from "../../src/brain-lifecycle.js"
import { DurableRunner } from "../../src/durable-runner.js"
import { Environments } from "../../src/environments.js"
import type { Models } from "../../src/models.js"
import { SandboxProvider } from "../../src/sandbox-provider.js"
import { LocalSandbox } from "../../src/sandbox-provider/local.js"
import { Settings } from "../../src/settings.js"
import { RenHostApiTest } from "./ren-host-api.js"
import { Seed } from "./seed.js"

const entry = join(import.meta.dir, "../../../cell/src/bun.ts")

export const keys = [await Effect.runPromise(Signature.generate("test"))] as const

const brainKeys = JSON.stringify(
  keys.map((key) => ({
    id: key.privateKey.id,
    key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key),
  })),
)

export const noEnvironments = Layer.succeed(
  Environments.Service,
  Environments.Service.of({
    bind: (_subject, environmentTemplateId) =>
      Effect.fail(
        new Environments.NotFound({
          message: `Environment template ${environmentTemplateId} is not available to this session`,
        }),
      ),
    findDirectory: () => Effect.succeed(Option.none()),
    unbind: () => Effect.void,
    access: (subject) =>
      Effect.fail(new Environments.NotFound({ message: `Session ${subject.sessionId} has no environment` })),
    release: () => Effect.void,
  }),
)

const freePort = Effect.promise(async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port ?? 0
  await probe.stop(true)
  return port
})

// oxlint-disable-next-line ren/no-comments -- Each brain is a real Bun brain process on this machine (LocalSandbox). It reaches this test's Ren Host API on REN_URL, which the BrainHost under test serves.
export const layerWith = <E, R>(
  config: Record<string, string>,
  models: Layer.Layer<Models.Service>,
  environments: Layer.Layer<Environments.Service, E, R>,
  around?: RenHostApiTest.Around,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const port = yield* freePort
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "ren-core-brains-"))),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      )
      const host = BrainHost.layerSandbox.pipe(
        Layer.provideMerge(BrainLifecycle.layer),
        Layer.provideMerge(LocalSandbox.layer({ entry, root })),
        Layer.provide(DurableRunner.layerMemory),
        Layer.provideMerge(BrainClient.layer),
        Layer.provide(Settings.layer),
        Layer.provide(models),
        Layer.provide(environments),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ BRAIN_KEYS: brainKeys, REN_URL: `http://127.0.0.1:${port}`, ...config }),
          ),
        ),
      )
      const serve = Layer.effectDiscard(
        Effect.gen(function* () {
          const context = yield* Effect.context<BrainHost.Service | SandboxProvider.Service>()
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
          const provider = Context.get(context, SandboxProvider.Service)
          yield* Effect.addFinalizer(() =>
            provider.list.pipe(
              Effect.flatMap((all) =>
                Effect.forEach(all, (each) => provider.destroy(each.binding).pipe(Effect.ignore)),
              ),
              Effect.ignore,
            ),
          )
        }),
      )
      return Layer.mergeAll(serve, Layer.effectDiscard(Seed.ren())).pipe(Layer.provideMerge(host))
    }),
  )

export const layer = (config: Record<string, string>, models: Layer.Layer<Models.Service>) =>
  layerWith(config, models, noEnvironments)

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
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ BRAIN_KEYS: brainKeys, ...config }))),
  )

export const ready = <E, R>(access: Effect.Effect<Session.ClientAccess, E, R>) =>
  access.pipe(
    Effect.flatMap((found) =>
      found.status === "ready" ? Effect.succeed(found) : Effect.fail(new Error(`The brain is ${found.status}`)),
    ),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 300 }),
    Effect.orDie,
  )
