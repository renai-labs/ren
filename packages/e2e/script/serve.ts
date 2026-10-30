import { PgClient } from "@effect/sql-pg"
import { Shared } from "@ren/cell/testing"
import { Access } from "@ren/core/access"
import { AppRegistry } from "@ren/core/app/registry"
import { Seed, TestDrives } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { TestEnvironment } from "@ren/executor/testing"
import { Signature } from "@ren/schema/signature"
import { Effect, Layer, Redacted, Schema } from "effect"
import os from "os"
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

const ModelEntry = Schema.Struct({
  model_name: Schema.String,
  model_info: Schema.Record(Schema.String, Schema.Unknown),
})

let log = ""
const children: Bun.Subprocess[] = []
const mailbox = Bun.serve({
  port: ports.mailbox,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    if (request.method === "POST" && new URL(request.url).pathname === "/models") {
      Shared.stub().modelInfo.set(Schema.decodeUnknownSync(Schema.Array(ModelEntry))(await request.json()))
      return new Response(null, { status: 204 })
    }
    const to = new URL(request.url).searchParams.get("to") ?? ""
    const start = log.lastIndexOf(`Email to ${to}:`)
    if (to === "" || start === -1) return new Response(null, { status: 404 })
    const next = log.indexOf("Email to ", start + 1)
    return new Response(log.slice(start, next === -1 ? undefined : next))
  },
})

let stopping: Promise<void> | undefined
const shutdown = (code: number) =>
  (stopping ??= (async () => {
    void mailbox.stop(true)
    for (const child of children) child.kill()
    await Promise.all(children.map((child) => child.exited))
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
  Effect.gen(function* () {
    yield* Seed.ren()
    const registry = yield* AppRegistry.Service
    yield* registry.publish(
      Schema.decodeUnknownSync(AppRegistry.Batch)({
        apps: [
          {
            slug: "e2e-docs",
            name: "Docs",
            description: "Look up library documentation",
            mcps: {
              docs: {
                name: "Docs",
                description: "Library documentation",
                transport: { type: "remote", url: "https://docs.example.com/mcp" },
                auth: { type: "none" },
              },
            },
            listing: { body: "Answers questions from library docs.", categories: { roles: ["engineer"] } },
          },
        ],
      }),
    )
  }).pipe(
    Effect.provide(AppRegistry.layer.pipe(Layer.provide(Access.layer))),
    Effect.provide(Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(database.href) })))),
  ),
).catch(failed)

const brainKey = await Effect.runPromise(Signature.generate("e2e"))
const server = Bun.spawn(["bun", "run", "src/main.ts"], {
  cwd: path.join(root, "server"),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(ports.server),
    DATABASE_URL: database.href,
    BETTER_AUTH_SECRET: "e2e-secret-do-not-use-in-production",
    ...TestDrives.config,
    BETTER_AUTH_URL: serverURL,
    TRUSTED_ORIGINS: appOrigin,
    APP_URL: `${appOrigin}/app`,
    GOOGLE_CLIENT_ID: "e2e-google-client-id",
    GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
    SIGNUP_MX_CHECK: "false",
    SANDBOX_PROVIDER: "local",
    LOCAL_BRAIN_ROOT: path.join(os.tmpdir(), `${name}-brains`),
    LOCAL_BRAIN_OWNER: String(process.pid),
    REN_URL: serverURL,
    // oxlint-disable-next-line ren/no-comments -- A brain's start signs its environment's executor variables, also when it has no environment.
    ENVIRONMENT_KEYS: JSON.stringify([
      {
        id: TestEnvironment.keys.privateKey.id,
        key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(TestEnvironment.keys.privateKey.key),
      },
    ]),
    REN_INFERENCE_GATEWAY_URL: Shared.stub().root,
    REN_INFERENCE_GATEWAY_KEY: "stub-key",
    ENVELOPE_KEYS: JSON.stringify([
      { id: "local:e2e", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
    ]),
    BRAIN_KEYS: JSON.stringify([
      {
        id: brainKey.privateKey.id,
        key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(brainKey.privateKey.key),
      },
    ]),
  },
  stdout: "pipe",
  stderr: "inherit",
})
children.push(server)

const build = Bun.spawn([process.execPath, "turbo", "build", "--filter=@ren/app", "--output-logs=errors-only"], {
  cwd: path.resolve(root, ".."),
  env: { ...process.env, VITE_REN_API_URL: serverURL },
  stdout: "inherit",
  stderr: "inherit",
})
children.push(build)
if ((await build.exited) !== 0) {
  console.error("Building the app failed")
  await shutdown(1)
}

const dist = path.join(root, "app", "dist")
Bun.serve({
  port: ports.app,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const pathname = new URL(request.url).pathname
    if (!pathname.startsWith("/app/")) return new Response("Not found", { status: 404 })
    const file = Bun.file(path.join(dist, path.normalize(pathname.slice("/app/".length))))
    if (await file.exists()) return new Response(file)
    return new Response(Bun.file(path.join(dist, "index.html")), { headers: { "content-type": "text/html" } })
  },
})

const decoder = new TextDecoder()
void (async () => {
  for await (const chunk of server.stdout) {
    const text = decoder.decode(chunk, { stream: true })
    log += text
    process.stdout.write(text)
  }
})()
