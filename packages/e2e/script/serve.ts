import { PgClient } from "@effect/sql-pg"
import { Celld, Shared, TestToken } from "@ren/cell/testing"
import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Effect, Layer, Redacted } from "effect"
import path from "path"
import { databaseURL, ports } from "../tests/lib/env.js"

const root = path.resolve(import.meta.dir, "../..")
const name = `ren_e2e_${crypto.randomUUID().replaceAll("-", "")}`
const database = new URL(databaseURL)
database.pathname = `/${name}`
const appOrigin = `http://127.0.0.1:${ports.app}`
const serverURL = `http://127.0.0.1:${ports.server}`

const admin = new Bun.SQL(databaseURL.href)
await admin.unsafe(`CREATE DATABASE "${name}"`)

let log = ""
const children: Bun.Subprocess[] = []
const mailbox = Bun.serve({
  port: ports.mailbox,
  hostname: "127.0.0.1",
  fetch: (request) => {
    const to = new URL(request.url).searchParams.get("to") ?? ""
    const start = log.lastIndexOf(`Email to ${to}:`)
    if (to === "" || start === -1) return new Response(null, { status: 404 })
    const next = log.indexOf("Email to ", start + 1)
    return new Response(log.slice(start, next === -1 ? undefined : next))
  },
})

const running: { cell?: Celld.Instance } = {}
let stopping: Promise<void> | undefined
const shutdown = (code: number) =>
  (stopping ??= (async () => {
    void mailbox.stop(true)
    for (const child of children) child.kill()
    await Promise.all(children.map((child) => child.exited))
    await running.cell?.dispose()
    await Shared.dispose()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.close()
    process.exit(code)
  })())
process.once("SIGTERM", () => void shutdown(0))
process.once("SIGINT", () => void shutdown(0))

const migrate = Bun.spawn(["bun", "run", "db", "migrate"], {
  cwd: path.join(root, "db"),
  env: { ...process.env, DATABASE_URL: database.href },
  stdout: "inherit",
  stderr: "inherit",
})
children.push(migrate)
if ((await migrate.exited) !== 0) {
  console.error("Migrating the e2e database failed")
  await shutdown(1)
}

const failed = async (error: unknown): Promise<never> => {
  console.error(error)
  await shutdown(1)
  throw error
}

await Effect.runPromise(
  Seed.ren().pipe(
    Effect.provide(Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(database.href) })))),
  ),
).catch(failed)

const cell = await Celld.make({
  ...Shared.vars(),
  REN_URL: serverURL.replace("127.0.0.1", "host.docker.internal"),
}).catch(failed)
running.cell = cell

const server = Bun.spawn(["bun", "run", "src/main.ts"], {
  cwd: path.join(root, "server"),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(ports.server),
    DATABASE_URL: database.href,
    BETTER_AUTH_SECRET: "e2e-secret-do-not-use-in-production",
    BETTER_AUTH_URL: serverURL,
    TRUSTED_ORIGINS: appOrigin,
    APP_URL: `${appOrigin}/app`,
    GOOGLE_CLIENT_ID: "e2e-google-client-id",
    GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
    SIGNUP_MX_CHECK: "false",
    CELL_URL: cell.url,
    CELL_KEYS: TestToken.vars.CELL_KEYS,
  },
  stdout: "pipe",
  stderr: "inherit",
})
children.push(server)

const app = Bun.spawn(["bunx", "vite", "--host", "127.0.0.1", "--port", String(ports.app), "--strictPort"], {
  cwd: path.join(root, "app"),
  env: { ...process.env, VITE_REN_API_URL: serverURL },
  stdout: "inherit",
  stderr: "inherit",
})
children.push(app)

const decoder = new TextDecoder()
void (async () => {
  for await (const chunk of server.stdout) {
    const text = decoder.decode(chunk, { stream: true })
    log += text
    process.stdout.write(text)
  }
})()
