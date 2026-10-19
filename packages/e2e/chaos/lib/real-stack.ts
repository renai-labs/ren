export * as RealStack from "./real-stack.js"

import { PgClient } from "@effect/sql-pg"
import { OpenCode } from "@opencode/client"
import { Signature } from "@ren/hand-api/signature"
import { Shared, TestToken, Wrangler } from "@ren/cell/testing"
import { BrainHost } from "@ren/core/brain-host"
import { HandProviders } from "@ren/core/hand-providers"
import { Hands } from "@ren/core/hands"
import { Models } from "@ren/core/models"
import { Database } from "@ren/db/database"
import { Sandbox } from "@ren/executor/testing"
import { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { SpaceEnvironment } from "@ren/schema/space-environment"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import os from "node:os"
import path from "node:path"
import { ExecutorAdapter } from "./adapters/executor.js"
import { SessionDriver } from "./drivers/session.js"
import { FaultProxy } from "./faults/proxy.js"
import { Process } from "./process.js"
import { ChaosHands } from "./provider/hands.js"
import { ModelProvider } from "./provider/model.js"
import { Wait } from "./wait.js"

const root = path.resolve(import.meta.dir, "../../..")
const adminUrl = process.env.DATABASE_URL ?? "postgres://ren:ren@localhost:54320/ren"

const freePort = async () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const found = Number(probe.url.port)
  await probe.stop(true)
  return found
}

const encodedKey = (key: Signature.PrivateKey) => ({
  id: key.id,
  key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key),
})

export interface EnvironmentOptions {
  readonly label: string
}

export interface Sandbox {
  readonly environmentId: Environment.ID
  readonly container: ExecutorAdapter.Container
  readonly proxy: () => FaultProxy.Instance
  readonly generation: () => number
  readonly folder: (sessionId: Session.ID) => string
  readonly retarget: () => void
  readonly replaceAtNewUrl: () => Promise<void>
  readonly replaceAtSameUrl: () => Promise<void>
}

export interface StartOptions extends Omit<SessionDriver.StartOptions, "environment"> {
  readonly withoutEnvironment?: boolean
}

export interface SessionOptions {
  readonly environment?: Sandbox | false
  readonly models?: Models.Access
  readonly start?: StartOptions
}

export const start = async (options: {
  readonly environments: ReadonlyArray<EnvironmentOptions>
  readonly tokenLifetime?: string
}) => {
  const name = `ren_e2e_${crypto.randomUUID().replaceAll("-", "")}`
  const admin = new Bun.SQL(adminUrl)
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  const database = new URL(adminUrl)
  database.pathname = `/${name}`
  const migrate = Bun.spawn(["bun", "run", "db", "migrate"], {
    cwd: path.join(root, "db"),
    env: { ...process.env, DATABASE_URL: database.href },
    stdout: "ignore",
    stderr: "inherit",
  })
  if ((await migrate.exited) !== 0) throw new Error("migrating the real-stack database failed")
  const databaseRuntime = ManagedRuntime.make(
    Database.layer.pipe(Layer.provideMerge(PgClient.layer({ url: Redacted.make(database.href) }))),
  )
  const organizationId = Auth.OrganizationID.create()
  await databaseRuntime.runPromise(
    Database.Service.use((service) =>
      service.db
        .insert(Database.Schema.organization)
        .values({ id: organizationId, name: "Real stack", slug: organizationId.toLowerCase(), createdAt: new Date() }),
    ),
  )

  const provider = await ModelProvider.start()
  const baseUrl = `${new URL(provider.url).origin}/v1`
  const grants = new Map<Session.ID, Models.Access>()
  const stubAccess = () => Shared.access({ stub: Shared.apiKey(`real-${crypto.randomUUID()}`) }, baseUrl)

  const sandboxes = await Promise.all(
    options.environments.map(async (environment) => {
      const container = await ExecutorAdapter.dockerContainer({ label: `real-${environment.label}` })
      const state = { generation: 1, proxy: await FaultProxy.make(container.url()) }
      const retired: Array<FaultProxy.Instance> = []
      return { environment, container, state, retired }
    }),
  )
  const handsFile = path.join(os.tmpdir(), `${name}-hands.json`)
  const writeHands = () =>
    Bun.write(
      handsFile,
      JSON.stringify(
        Object.fromEntries(
          sandboxes.map((sandbox) => [
            sandbox.container.environmentId,
            { url: sandbox.state.proxy.url, generation: sandbox.state.generation },
          ]),
        ),
      ),
    )
  await writeHands()
  const spaceId = Space.ID.create()
  await databaseRuntime.runPromise(
    Database.Service.use((service) =>
      service.db
        .insert(Database.Schema.space)
        .values({ id: spaceId, organization_id: organizationId, name: "Real stack" })
        .pipe(
          Effect.andThen(
            service.db.insert(Database.Schema.environment).values(
              sandboxes.map((sandbox) => ({
                id: sandbox.container.environmentId,
                organization_id: organizationId,
                name: sandbox.environment.label,
                provider: ChaosHands.providerId,
                config: {},
                sessions_per_hand: Environment.maximumSessionsPerHand,
              })),
            ),
          ),
          Effect.andThen(
            service.db.insert(Database.Schema.space_environment).values(
              sandboxes.map((sandbox) => ({
                id: SpaceEnvironment.ID.create(),
                space_id: spaceId,
                environment_id: sandbox.container.environmentId,
              })),
            ),
          ),
        ),
    ),
  )

  const serverPort = await freePort()
  const renProxy = await FaultProxy.make(`http://127.0.0.1:${serverPort}`)
  const cell = await Wrangler.make({ ...Shared.vars(baseUrl), REN_URL: renProxy.url })
  const forgetCell = Process.onInterrupt(cell.crash)

  const keys = {
    CELL_KEYS: TestToken.vars.CELL_KEYS,
    ENVIRONMENT_KEYS: JSON.stringify([encodedKey(Sandbox.keys.privateKey)]),
    ...(options.tokenLifetime && { ENVIRONMENT_TOKEN_LIFETIME: options.tokenLifetime }),
  }
  const server = { child: undefined as Bun.Subprocess | undefined, log: "" }
  const startServer = async () => {
    const child = Bun.spawn(["bun", "run", path.join(import.meta.dir, "server-main.ts")], {
      cwd: path.join(root, "e2e"),
      env: {
        ...process.env,
        ...keys,
        NODE_ENV: "test",
        PORT: String(serverPort),
        DATABASE_URL: database.href,
        BETTER_AUTH_SECRET: "e2e-secret-do-not-use-in-production",
        BETTER_AUTH_URL: `http://127.0.0.1:${serverPort}`,
        TRUSTED_ORIGINS: `http://127.0.0.1:${serverPort}`,
        APP_URL: `http://127.0.0.1:${serverPort}/app`,
        GOOGLE_CLIENT_ID: "e2e-google-client-id",
        GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
        SIGNUP_MX_CHECK: "false",
        CELL_URL: cell.url,
        [ChaosHands.fileVariable]: handsFile,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    server.child = child
    for (const stream of [child.stdout, child.stderr])
      void (async () => {
        for await (const chunk of stream) server.log += new TextDecoder().decode(chunk)
      })()
    await Wait.until("the Ren server to answer /health", 60_000, async () => {
      if (child.exitCode !== null) throw new Error(`the Ren server exited with ${child.exitCode}:\n${server.log}`)
      const response = await fetch(`http://127.0.0.1:${serverPort}/health`).catch(() => undefined)
      return response?.ok ? true : undefined
    })
  }
  const stopServer = async () => {
    server.child?.kill("SIGKILL")
    await server.child?.exited
    server.child = undefined
  }
  const forgetServer = Process.onInterrupt(stopServer)
  await startServer()

  const databaseContext = await databaseRuntime.runPromise(Effect.context<Database.Service>())
  const models = Layer.succeed(
    Models.Service,
    Models.Service.of({
      catalog: () => Effect.succeed({ endpoints: [] }),
      grant: (subject) => Effect.sync(() => grants.get(subject.brainId) ?? stubAccess()),
      refreshIfDue: () => Effect.succeedNone,
      revoke: () => Effect.void,
    }),
  )
  const core = <A, E>(use: (brain: BrainHost.Interface) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      BrainHost.Service.use(use).pipe(
        Effect.provide(
          Layer.fresh(BrainHost.layer).pipe(
            Layer.provide(models),
            Layer.provide(
              Hands.layer.pipe(
                Layer.provide(HandProviders.layer(ChaosHands.providers)),
                Layer.provide(Layer.succeedContext(databaseContext)),
              ),
            ),
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(
              ConfigProvider.layer(
                ConfigProvider.fromUnknown({ ...keys, CELL_URL: cell.url, [ChaosHands.fileVariable]: handsFile }),
              ),
            ),
          ),
        ),
      ),
    )
  const sandbox = (entry: (typeof sandboxes)[number]): Sandbox => ({
    environmentId: entry.container.environmentId,
    container: entry.container,
    proxy: () => entry.state.proxy,
    generation: () => entry.state.generation,
    folder: (sessionId) => `/workspace/${sessionId}`,
    retarget: () => entry.state.proxy.target(entry.container.url()),
    replaceAtNewUrl: async () => {
      await entry.container.replace()
      entry.state.proxy.partition(true)
      entry.state.proxy.cutAll()
      entry.retired.push(entry.state.proxy)
      entry.state.proxy = await FaultProxy.make(entry.container.url())
      entry.state.generation += 1
      await writeHands()
      await stopServer()
      await startServer()
    },
    replaceAtSameUrl: async () => {
      await entry.container.replace()
      entry.state.proxy.target(entry.container.url())
      entry.state.generation += 1
      await writeHands()
      await stopServer()
      await startServer()
    },
  })

  const session = async (sessionOptions: SessionOptions = {}) => {
    const sessionId = Session.ID.create()
    if (sessionOptions.models) grants.set(sessionId, sessionOptions.models)
    const environment = sessionOptions.environment === false ? undefined : (sessionOptions.environment ?? first)
    const startSession = (startOptions: StartOptions = {}) =>
      core((brain) =>
        brain.start(
          {
            sessionId,
            harness: "opencode",
            instructions: startOptions.instructions ?? {},
            interactive: startOptions.interactive ?? false,
            ...(environment &&
              !startOptions.withoutEnvironment && {
                environmentId: environment.environmentId,
              }),
            ...(startOptions.model && { model: startOptions.model }),
          },
          { organizationId, spaceId },
        ),
      )
    await startSession(sessionOptions.start)
    const access = await core((brain) => brain.access(sessionId))
    const opencode = OpenCode.make({ baseUrl: access.url, headers: { authorization: TestToken.basic(access.token) } })
    const send = (text: string) =>
      core((brain) =>
        brain.send(
          {
            sessionId,
            messageId: Session.MessageID.create(),
            prompt: { text },
            delivery: "steer",
            sender: { userId: "user_real" },
          },
          organizationId,
        ),
      )
    const messages = () => SessionDriver.messages(opencode, sessionId)
    return {
      sessionId,
      opencode,
      start: startSession,
      send,
      messages,
      settled: async (ms = 60_000) => {
        await Wait.deadline(`session ${sessionId} to settle`, ms, opencode.session.wait({ sessionID: sessionId }))
        return messages()
      },
      turn: async (steps: ReadonlyArray<ModelProvider.Step>, text = "work") => {
        const script = provider.script(steps)
        await send(`${text} ${script.marker}`)
        return script
      },
      tool: async (name: string, input: unknown, ms = 120_000) => {
        const script = provider.script([ModelProvider.tool(name, input), ModelProvider.text("ok")])
        await send(`work ${script.marker}`)
        const result = (await script.called(2, ms)).toolResults
        await Wait.deadline(`session ${sessionId} to settle`, 60_000, opencode.session.wait({ sessionID: sessionId }))
        return result
      },
    }
  }

  const all = sandboxes.map(sandbox)
  const [first] = all
  if (!first) throw new Error("the real stack needs at least one environment")

  return {
    sandboxes: all,
    sandbox: (label: string) => {
      const found = all.find((_, index) => sandboxes[index]?.environment.label === label)
      if (!found) throw new Error(`no environment ${label}`)
      return found
    },
    provider,
    cell,
    renProxy,
    session,
    issued: () => renProxy.count("POST /brain/environment/access"),
    serverLog: () => server.log,
    restartServer: async () => {
      await stopServer()
      await startServer()
    },
    stopServer,
    startServer,
    restartCell: async () => {
      await cell.crash()
      await cell.start()
    },
    dispose: async () => {
      const logs = path.resolve(
        import.meta.dir,
        "../../.runs",
        `real-stack-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
      )
      await Bun.write(path.join(logs, "cell.log"), await cell.logs())
      await Bun.write(path.join(logs, "server.log"), server.log)
      forgetCell()
      forgetServer()
      await stopServer()
      await cell.dispose()
      await Promise.all(
        sandboxes.map((entry) =>
          Promise.all([
            entry.state.proxy.stop(),
            ...entry.retired.map((proxy) => proxy.stop()),
            entry.container.dispose(),
          ]),
        ),
      )
      await Promise.all([renProxy.stop(), provider.stop()])
      await databaseRuntime.dispose()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.close()
    },
  }
}

export type Instance = Awaited<ReturnType<typeof start>>
export type Driver = Awaited<ReturnType<Instance["session"]>>
