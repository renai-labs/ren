export * as RealStack from "./real-stack.js"

import { PgClient } from "@effect/sql-pg"
import { OpenCode } from "@opencode/client"
import { Signature } from "@ren/environment-api/signature"
import { Shared, TestToken, Wrangler } from "@ren/cell/testing"
import { BrainHost } from "@ren/core/brain-host"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Environments } from "@ren/core/environments"
import { Models } from "@ren/core/models"
import { Session } from "@ren/core/session"
import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { TestEnvironment } from "@ren/executor/testing"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Environment } from "@ren/schema/environment"
import type { Session as SessionSchema } from "@ren/schema/session"
import { SpaceEnvironmentTemplate } from "@ren/schema/space-environment-template"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import os from "node:os"
import path from "node:path"
import { ExecutorAdapter } from "./adapters/executor.js"
import { SessionDriver } from "./drivers/session.js"
import { FaultProxy } from "./faults/proxy.js"
import { Process } from "./process.js"
import { ChaosEnvironments } from "./provider/environments.js"
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
  readonly environmentTemplateId: EnvironmentTemplate.ID
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

export interface Local {
  readonly title: string | null
  readonly messages: ReadonlyArray<string>
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
  const direct = new Bun.SQL(database.href)
  const databaseRuntime = ManagedRuntime.make(
    Database.layer.pipe(Layer.provideMerge(PgClient.layer({ url: Redacted.make(database.href) }))),
  )
  const owner = await databaseRuntime.runPromise(Seed.owner())

  const provider = await ModelProvider.start()
  const baseUrl = `${new URL(provider.url).origin}/v1`
  const grants = new Map<Session.ID, Models.Access>()
  const stubAccess = () => Shared.access({ stub: Shared.apiKey(`real-${crypto.randomUUID()}`) }, baseUrl)

  const sandboxes = await Promise.all(
    options.environments.map(async (environment) => {
      const environmentTemplateId = EnvironmentTemplate.ID.create()
      const container = await ExecutorAdapter.dockerContainer({ label: `real-${environment.label}` })
      const state = { generation: 1, proxy: await FaultProxy.make(container.url()) }
      const retired: Array<FaultProxy.Instance> = []
      return { environment, environmentTemplateId, container, state, retired }
    }),
  )
  const environmentsFile = path.join(os.tmpdir(), `${name}-environments.json`)
  const writeEnvironments = () =>
    Bun.write(
      environmentsFile,
      JSON.stringify(
        Object.fromEntries(
          sandboxes.map((sandbox) => [
            sandbox.environmentTemplateId,
            { url: sandbox.state.proxy.url, generation: sandbox.state.generation },
          ]),
        ),
      ),
    )
  await writeEnvironments()
  await databaseRuntime.runPromise(
    Database.Service.use((service) =>
      service.db
        .insert(Database.Schema.environment_template)
        .values(
          sandboxes.map((sandbox) => ({
            id: sandbox.environmentTemplateId,
            organization_id: owner.organizationId,
            name: sandbox.environment.label,
            provider: ChaosEnvironments.providerId,
            config: {},
            sessions_per_environment: EnvironmentTemplate.maximumSessionsPerEnvironment,
          })),
        )
        .pipe(
          Effect.andThen(
            service.db.insert(Database.Schema.space_environment_template).values(
              sandboxes.map((sandbox) => ({
                id: SpaceEnvironmentTemplate.ID.create(),
                space_id: owner.spaceId,
                environment_template_id: sandbox.environmentTemplateId,
              })),
            ),
          ),
          Effect.andThen(
            service.db.insert(Database.Schema.environment).values(
              sandboxes.map((sandbox) => ({
                id: sandbox.container.environmentId,
                environment_template_id: sandbox.environmentTemplateId,
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
    ENVIRONMENT_KEYS: JSON.stringify([encodedKey(TestEnvironment.keys.privateKey)]),
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
        [ChaosEnvironments.fileVariable]: environmentsFile,
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
      grant: (subject) => Effect.sync(() => grants.get(subject.sessionId) ?? stubAccess()),
      refreshIfDue: () => Effect.succeedNone,
      revoke: () => Effect.void,
    }),
  )
  const core = <A, E>(effect: Effect.Effect<A, E, BrainHost.Service | Session.Service>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          Layer.fresh(Session.layer).pipe(
            Layer.provideMerge(
              Layer.fresh(BrainHost.layer).pipe(
                Layer.provide(models),
                Layer.provide(
                  Environments.layer.pipe(Layer.provide(EnvironmentProvider.layer(ChaosEnvironments.providers))),
                ),
                Layer.provide(FetchHttpClient.layer),
                Layer.provide(
                  ConfigProvider.layer(
                    ConfigProvider.fromUnknown({
                      ...keys,
                      CELL_URL: cell.url,
                      [ChaosEnvironments.fileVariable]: environmentsFile,
                    }),
                  ),
                ),
              ),
            ),
            Layer.provide(Layer.succeedContext(databaseContext)),
          ),
        ),
      ),
    )
  const replaceContainer = async (entry: (typeof sandboxes)[number]) => {
    const environmentId = Environment.ID.create()
    await entry.container.replace(environmentId)
    await direct`DELETE FROM environment WHERE environment_template_id = ${entry.environmentTemplateId} AND binding IS NULL`
    await direct`INSERT INTO environment (id, environment_template_id) VALUES (${environmentId}, ${entry.environmentTemplateId})`
  }
  const remote = (sessionId: Session.ID) =>
    databaseRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const session = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ title: Schema.NullOr(Schema.String) })))(
          yield* sql`select title from opencode_session where session_id = ${sessionId}`,
        )
        const messages = Schema.decodeUnknownSync(
          Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })),
        )(yield* sql`select id, type from opencode_message where session_id = ${sessionId}`)
        return { title: session.at(0)?.title ?? null, messages }
      }),
    )
  const sandbox = (entry: (typeof sandboxes)[number]): Sandbox => ({
    environmentTemplateId: entry.environmentTemplateId,
    container: entry.container,
    proxy: () => entry.state.proxy,
    generation: () => entry.state.generation,
    folder: (sessionId) => `/workspace/${sessionId}`,
    retarget: () => entry.state.proxy.target(entry.container.url()),
    replaceAtNewUrl: async () => {
      await replaceContainer(entry)
      entry.state.proxy.partition(true)
      entry.state.proxy.cutAll()
      entry.retired.push(entry.state.proxy)
      entry.state.proxy = await FaultProxy.make(entry.container.url())
      entry.state.generation += 1
      await writeEnvironments()
      await stopServer()
      await startServer()
    },
    replaceAtSameUrl: async () => {
      await replaceContainer(entry)
      entry.state.proxy.target(entry.container.url())
      entry.state.generation += 1
      await writeEnvironments()
      await stopServer()
      await startServer()
    },
  })

  const session = async (sessionOptions: SessionOptions = {}) => {
    const sessionId = Session.ID.create()
    if (sessionOptions.models) grants.set(sessionId, sessionOptions.models)
    const environment = sessionOptions.environment === false ? undefined : (sessionOptions.environment ?? first)
    const input = (startOptions: StartOptions = {}): SessionSchema.StartInput => ({
      sessionId,
      harness: "opencode",
      interactive: startOptions.interactive ?? false,
      ...(environment &&
        !startOptions.withoutEnvironment && {
          environmentTemplateId: environment.environmentTemplateId,
        }),
      ...(startOptions.model && { model: startOptions.model }),
    })
    const startSession = (startOptions?: StartOptions) =>
      core(BrainHost.Service.use((brain) => brain.start(input(startOptions), owner)))
    await core(Session.Service.use((sessions) => sessions.create(owner, input(sessionOptions.start))))
    const access = await core(BrainHost.Service.use((brain) => brain.access(sessionId)))
    const opencode = OpenCode.make({ baseUrl: access.url, headers: { authorization: TestToken.basic(access.token) } })
    const send = (text: string) =>
      core(
        Session.Service.use((sessions) =>
          sessions.send({
            sessionId,
            messageId: Session.MessageID.create(),
            prompt: { text },
            delivery: "steer",
            sender: { userId: owner.createdBy },
          }),
        ),
      )
    const messages = () => SessionDriver.messages(opencode, sessionId)
    const rows = (read: { readonly messages: ReadonlyArray<{ readonly id: string; readonly type: string }> }) =>
      read.messages.map((message) => `${message.id} ${message.type}`).toSorted()
    const local = async (): Promise<Local> => ({
      title: (await opencode.session.get({ sessionID: sessionId })).title ?? null,
      messages: rows({ messages: await messages() }),
    })
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
      local,
      synced: async (expected?: Local, ms = 60_000) => {
        const target = expected ?? (await local())
        return Wait.until(`Postgres to match session ${sessionId} in the cell`, ms, async () => {
          const read = await remote(sessionId)
          const found = { title: read.title, messages: rows(read) }
          return Bun.deepEquals(found, target) ? found : undefined
        })
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
    issued: () => renProxy.count("POST /host/environment/access"),
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
    loseCellStorage: cell.loseStorage,
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
      await direct.close()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.close()
    },
  }
}

export type Instance = Awaited<ReturnType<typeof start>>
export type Driver = Awaited<ReturnType<Instance["session"]>>
