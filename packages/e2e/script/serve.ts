import path from "path"

const ports = {
  server: Number(process.env.E2E_PORT ?? 4010),
  app: Number(process.env.E2E_APP_PORT ?? 4011),
  mailbox: Number(process.env.E2E_MAILBOX_PORT ?? 4012),
}
const root = path.resolve(import.meta.dir, "../..")
const base = new URL(process.env.DATABASE_URL ?? "postgres://ren:ren@localhost:54320/ren")
const name = `ren_e2e_${crypto.randomUUID().replaceAll("-", "")}`
const database = new URL(base)
database.pathname = `/${name}`
const appURL = `http://127.0.0.1:${ports.app}`

const admin = new Bun.SQL(base.href)
await admin.unsafe(`CREATE DATABASE "${name}"`)

const migrate = Bun.spawn(["bun", "run", "db", "migrate"], {
  cwd: path.join(root, "db"),
  env: { ...process.env, DATABASE_URL: database.href },
  stdout: "inherit",
  stderr: "inherit",
})
if ((await migrate.exited) !== 0) throw new Error("Migrating the e2e database failed")

const server = Bun.spawn(["bun", "run", "src/main.ts"], {
  cwd: path.join(root, "server"),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(ports.server),
    DATABASE_URL: database.href,
    BETTER_AUTH_SECRET: "e2e-secret-do-not-use-in-production",
    BETTER_AUTH_URL: appURL,
    TRUSTED_ORIGINS: appURL,
    APP_URL: appURL,
    GOOGLE_CLIENT_ID: "e2e-google-client-id",
    GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
    SIGNUP_MX_CHECK: "false",
  },
  stdout: "pipe",
  stderr: "inherit",
})

const app = Bun.spawn(["bunx", "vite", "--host", "127.0.0.1", "--port", String(ports.app), "--strictPort"], {
  cwd: path.join(root, "app"),
  env: { ...process.env, REN_API_URL: `http://127.0.0.1:${ports.server}` },
  stdout: "inherit",
  stderr: "inherit",
})

let log = ""
const decoder = new TextDecoder()
void (async () => {
  for await (const chunk of server.stdout) {
    const text = decoder.decode(chunk, { stream: true })
    log += text
    process.stdout.write(text)
  }
})()

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

const shutdown = async () => {
  void mailbox.stop(true)
  app.kill()
  server.kill()
  await Promise.all([app.exited, server.exited])
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.close()
  process.exit(0)
}
process.once("SIGTERM", () => void shutdown())
process.once("SIGINT", () => void shutdown())
