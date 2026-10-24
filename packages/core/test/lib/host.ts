export * as Host from "./host.js"

import { BunCrypto } from "@effect/platform-bun"
import { Shared, TestToken, Wrangler } from "@ren/cell/testing"
import { TestEnvironment } from "@ren/executor/testing"
import type { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Context, type Duration, Effect, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient, type HttpClient, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "@ren/db/database"
import { BrainClient } from "../../src/brain-client.js"
import { BrainHost } from "../../src/brain-host.js"
import { Brains } from "../../src/brains.js"
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
import { Signer } from "../../src/signer.js"

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

export const noTemplates = Environments.layer
  .pipe(Layer.provide(Signer.layerLocal))
  .pipe(Layer.provide(EnvironmentProvider.layer<never, never>([])))

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
  readonly maxRunning?: number
  readonly template?: string
  readonly sandbox?: Layer.Layer<SandboxProvider.Service, unknown, HttpClient.HttpClient>
}

// oxlint-disable-next-line ren/no-comments -- Each brain is a real Bun brain process on this machine (LocalSandbox), under root. Brains reach Ren on REN_URL, where serve answers.
export const stack = <E, R>(options: StackOptions<E, R>) =>
  Brains.layer.pipe(
    Layer.provideMerge(BrainHost.layerSandbox),
    Layer.provideMerge(BrainLifecycle.layer),
    Layer.provideMerge(
      options.sandbox ??
        LocalSandbox.layer({
          entry,
          executor,
          root: options.root,
          ...(options.lostEvery && { lostEvery: options.lostEvery }),
          ...(options.maxRunning && { maxRunning: options.maxRunning }),
          ...(options.template && { template: options.template }),
        }),
    ),
    Layer.provideMerge(DurableRunner.layerEffect.pipe(Layer.provide(BunCrypto.layer))),
    Layer.provideMerge(BrainClient.layer.pipe(Layer.provide(Signer.layerLocal))),
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

interface Fault {
  readonly match: (path: string) => boolean
  readonly before: () => Promise<"fail" | "pass">
}

// oxlint-disable-next-line ren/no-comments -- What the brains' requests to Ren meet: a test fails or holds the requests whose path matches, and reads the paths the brains asked for.
export class Outage extends Context.Service<
  Outage,
  {
    readonly paths: ReadonlyArray<string>
    readonly fail: (match: (path: string) => boolean) => void
    readonly hold: (match: (path: string) => boolean) => {
      readonly entered: Promise<void>
      readonly release: () => void
    }
    readonly clear: () => void
  }
>()("@ren/core/test/Host/Outage") {}

const outage = () => {
  const paths: Array<string> = []
  const faults: Array<Fault> = []
  return {
    paths,
    faults,
    service: Outage.of({
      paths,
      fail: (match) => void faults.push({ match, before: () => Promise.resolve("fail") }),
      hold: (match) => {
        const entered = Promise.withResolvers<void>()
        const released = Promise.withResolvers<void>()
        const fault: Fault = {
          match,
          before: () => {
            faults.splice(faults.indexOf(fault), 1)
            entered.resolve()
            return released.promise.then(() => "pass")
          },
        }
        faults.push(fault)
        return { entered: entered.promise, release: () => released.resolve() }
      },
      clear: () => void faults.splice(0),
    }),
  }
}

const listen = (
  port: number,
  api: { readonly handler: (request: Request) => Promise<Response>; readonly dispose: () => Promise<void> },
  faults: ReturnType<typeof outage> = outage(),
) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port,
        idleTimeout: 0,
        fetch: async (request) => {
          const path = new URL(request.url).pathname
          faults.paths.push(path)
          const fault = faults.faults.find((each) => each.match(path))
          if (fault && (await fault.before()) === "fail") return new Response("Ren is down", { status: 503 })
          return api.handler(request)
        },
      }),
    ),
    (server) =>
      Effect.promise(async () => {
        await server.stop(true)
        await api.dispose()
      }),
  )

// oxlint-disable-next-line ren/no-comments -- The Ren Host API of the BrainHost in context, on port. A test stops it to take Ren down for the brains while it still calls BrainHost itself.
export const serve = (port: number, around?: RenHostApiTest.Around) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<Brains.Service>()
      yield* listen(
        port,
        HttpRouter.toWebHandler(
          RenHostApiTest.layer(around).pipe(
            Layer.provide(Layer.succeedContext(context)),
            Layer.provide(HttpServer.layerServices),
          ),
          { disableLogger: true },
        ),
      )
    }),
  )

// oxlint-disable-next-line ren/no-comments -- As serve, and the brains sync into Postgres.
const serveSynced = (port: number) =>
  Layer.effect(
    Outage,
    Effect.gen(function* () {
      const context = yield* Effect.context<Brains.Service | Database.Service>()
      const faults = outage()
      yield* listen(
        port,
        HttpRouter.toWebHandler(
          RenHostApiTest.layerSynced().pipe(
            Layer.provide(Layer.succeedContext(context)),
            Layer.provide(HttpServer.layerServices),
          ),
          { disableLogger: true },
        ),
        faults,
      )
      return faults.service
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
  options: { readonly synced?: boolean } = {},
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const found = yield* freePort
      return Layer.mergeAll(
        options.synced ? serveSynced(found) : serve(found, around),
        destroyBrains,
        Layer.effectDiscard(Seed.ren()),
      ).pipe(Layer.provideMerge(stack({ port: found, root: yield* root, config, models, environments })))
    }),
  )

export const layer = (config: Record<string, string>, models: Layer.Layer<Models.Service>) =>
  layerWith(config, models, noTemplates)

// oxlint-disable-next-line ren/no-comments -- As layer, and the brains sync into Postgres, so a test can restore chats.
export const layerSynced = (config: Record<string, string>, models: Layer.Layer<Models.Service>) =>
  layerWith(config, models, noTemplates, undefined, { synced: true })

// oxlint-disable-next-line ren/no-comments -- BrainHost.layerCell reaches every brain at CELL_URL, so a test can put a server that fails on purpose there.
export const cellLayer = <E, R>(
  config: Record<string, string>,
  models: Layer.Layer<Models.Service>,
  environments: Layer.Layer<Environments.Service, E, R>,
) =>
  Layer.fresh(Brains.layer).pipe(
    Layer.provideMerge(BrainHost.layerCell),
    Layer.provideMerge(DurableRunner.layerMemory),
    Layer.provideMerge(BrainClient.layer.pipe(Layer.provide(Signer.layerLocal))),
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

// oxlint-disable-next-line ren/no-comments -- The workerd cell (wrangler dev), started once per file. It reaches Ren on port, and trusts the cell test keys.
export const wrangler = async () => {
  const port = await Effect.runPromise(freePort)
  const cell = await Wrangler.make({ ...Shared.vars(Shared.stub().url), REN_URL: `http://127.0.0.1:${port}` })
  return { url: cell.url, port, dispose: cell.dispose }
}

const cellKeys = JSON.stringify(
  TestToken.keys.map((key) => ({ id: key.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key) })),
)

export const wranglerLayer = (
  cell: { readonly url: string; readonly port: number },
  models: Layer.Layer<Models.Service>,
) =>
  Layer.mergeAll(serve(cell.port), Layer.effectDiscard(Seed.ren())).pipe(
    Layer.provideMerge(cellLayer({ CELL_URL: cell.url, BRAIN_KEYS: cellKeys }, models, noTemplates)),
  )

const LocalBinding = Schema.Struct({ pid: Schema.Int, home: Schema.String })

// oxlint-disable-next-line ren/no-comments -- Stops a local brain, changes its disk while no brain process runs, and lets the restart loop boot it again.
export const restart = Effect.fnUntraced(function* (brainId: Brain.ID, change: (home: string) => Promise<unknown>) {
  const provider = yield* SandboxProvider.Service
  const found = (yield* provider.list.pipe(Effect.orDie)).find((each) => each.brainId === brainId)
  if (!found) return yield* Effect.die(new Error(`Brain ${brainId} has no sandbox`))
  const binding = Schema.decodeUnknownSync(LocalBinding)(found.binding)
  const brains = () =>
    new TextDecoder()
      .decode(Bun.spawnSync(["pgrep", "-g", String(binding.pid), "-f", "^bun .*cell/src/bun\\.ts"]).stdout)
      .split("\n")
      .filter(Boolean)
  process.kill(binding.pid, "SIGSTOP")
  yield* Effect.forEach(brains(), (pid) => Effect.sync(() => process.kill(Number(pid), "SIGKILL")), { discard: true })
  yield* Effect.sync(brains).pipe(
    Effect.repeat({ until: (left) => left.length === 0, schedule: Schedule.spaced("20 millis") }),
  )
  yield* Effect.promise(() => change(binding.home))
  process.kill(binding.pid, "SIGCONT")
})

// oxlint-disable-next-line ren/no-comments -- The brain loses its harness database, as on a new sandbox, and keeps brain.db: the database is deleted while no brain process runs.
export const forgetHarness = (brainId: Brain.ID, options: { readonly folderOf?: Session.ID } = {}) =>
  restart(brainId, (home) =>
    Promise.all([
      ...["opencode.db", "opencode.db-wal", "opencode.db-shm"].map((name) =>
        rm(join(home, ".ren", name), { force: true }),
      ),
      ...(options.folderOf ? [rm(join(home, "workspace", options.folderOf), { recursive: true, force: true })] : []),
    ]),
  )

export const ready = <E, R>(access: Effect.Effect<Session.ClientAccess, E, R>) =>
  access.pipe(
    Effect.flatMap((found) =>
      found.status === "ready" ? Effect.succeed(found) : Effect.fail(new Error(`The brain is ${found.status}`)),
    ),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 300 }),
    Effect.orDie,
  )
