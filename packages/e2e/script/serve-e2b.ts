import { Signature } from "@ren/schema/signature"
import { S3Client } from "bun"
import { Sandbox } from "e2b"
import { Effect, Schema } from "effect"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"

const usage = `Usage:
  bun serve-e2b.ts          Runs Ren from this checkout with its brains in E2B sandboxes, behind this
                            checkout's egress, until SIGTERM or SIGINT; then removes all of it. Prints
                            "ready <run dir>/run.env" when the app answers.
  bun serve-e2b.ts clean    Removes what stopped runs left: containers, E2B sandboxes, tunnels.

Needs E2B_API_KEY, NGROK_AUTHTOKEN, QA_INFERENCE_GATEWAY_KEY, and docker, go and ngrok. Passes
SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET to the server when they are set.
REN_E2E_HOME: state folder, ~/.local/state/ren-e2e by default. REN_E2E_RUNS: runs at the same time, 2.`

const { positionals } = parseArgs({ allowPositionals: true })
const repository = path.resolve(import.meta.dir, "../../..")
const home = process.env.REN_E2E_HOME ?? path.join(os.homedir(), ".local/state/ren-e2e")
const runs = path.join(home, "runs")
const limit = Number(process.env.REN_E2E_RUNS ?? "2")
const ngrokApi = "http://127.0.0.1:4040/api"
const gateway = "https://llm.v2.useren.ai"
const storage = { accessKeyId: "rendev", secretAccessKey: "ren-dev-secret" }

const required = (name: string) => {
  const value = process.env[name]
  if (value) return value
  console.error(`Missing ${name}.\n\n${usage}`)
  return process.exit(2)
}

const sh = (command: string, cwd = repository, env: Record<string, string> = {}) =>
  Bun.$`sh -c ${command}`
    .cwd(cwd)
    .env({ ...process.env, ...env })
    .quiet()
    .nothrow()

const must = async (label: string, command: string, cwd = repository, env: Record<string, string> = {}) => {
  const result = await sh(command, cwd, env)
  if (result.exitCode !== 0) throw new Error(`${label} failed:\n${result.stderr.toString()}${result.stdout.toString()}`)
  return result.stdout.toString()
}

const until = async (label: string, check: () => Promise<boolean>, seconds: number): Promise<void> => {
  if (await check()) return
  if (seconds <= 0) throw new Error(`${label} is not ready`)
  await Bun.sleep(1000)
  return until(label, check, seconds - 1)
}

const answers = (url: string) => () =>
  fetch(url, { signal: AbortSignal.timeout(3000) }).then(
    (response) => response.status < 500,
    () => false,
  )

const listening = (port: number) => () =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    socket.once("connect", () => resolve(Boolean(socket.end())))
    socket.once("error", () => resolve(false))
  })

const freePort = () => {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port ?? 0
  void probe.stop(true)
  return port
}

const alive = (pid: number) => Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0

const pidOf = (name: string) => {
  const file = path.join(runs, name, "pid")
  return existsSync(file) ? Number(readFileSync(file, "utf8")) : 0
}

const liveRuns = () => (existsSync(runs) ? readdirSync(runs) : []).filter((name) => alive(pidOf(name)))

const compose = async () => {
  const sudo = (await sh("docker info")).exitCode === 0 ? "" : "sudo "
  return (await sh(`${sudo}docker compose version`)).exitCode === 0 ? `${sudo}docker compose` : `${sudo}docker-compose`
}

const Tunnels = Schema.Struct({ tunnels: Schema.Array(Schema.Struct({ name: Schema.String })) })

const removeRun = async (name: string, apiKey: string) => {
  const docker = await compose()
  const file = path.join(runs, name, "compose.yaml")
  if (existsSync(file)) await sh(`${docker} -p ${name} -f ${file} down -v`)
  const sandboxes = await Sandbox.list({ apiKey, query: { metadata: { owner: name } } }).nextItems()
  await Promise.all(sandboxes.map((sandbox) => Sandbox.kill(sandbox.sandboxId, { apiKey })))
  const tunnels = await fetch(`${ngrokApi}/tunnels`).then(
    async (response) => Schema.decodeUnknownSync(Tunnels)(await response.json()).tunnels,
    () => [],
  )
  await Promise.all(
    tunnels
      .filter((tunnel) => tunnel.name.startsWith(name))
      .map((tunnel) => fetch(`${ngrokApi}/tunnels/${tunnel.name}`, { method: "DELETE" })),
  )
  rmSync(path.join(runs, name), { recursive: true, force: true })
  return sandboxes.length
}

const clean = async (apiKey: string) => {
  const live = new Set(liveRuns())
  const dead = (existsSync(runs) ? readdirSync(runs) : []).filter((name) => !live.has(name))
  const removed = await Promise.all(
    dead.map(async (name) => `removed ${name} (${await removeRun(name, apiKey)} E2B sandboxes)`),
  )
  if (removed.length > 0) console.log(removed.join("\n"))
}

if (positionals[0] === "clean") {
  await clean(required("E2B_API_KEY"))
  process.exit(0)
}
if (positionals.length > 0) {
  console.error(usage)
  process.exit(2)
}

const e2bKey = required("E2B_API_KEY")
const ngrokToken = required("NGROK_AUTHTOKEN")
const gatewayKey = required("QA_INFERENCE_GATEWAY_KEY")
mkdirSync(runs, { recursive: true })
await clean(e2bKey)

const name = `e2e-${crypto.randomUUID().slice(0, 6)}`
const dir = path.join(runs, name)
const lock = path.join(home, "start.lock")
const claim = async (): Promise<void> => {
  if (Bun.spawnSync(["mkdir", lock]).exitCode !== 0) {
    await Bun.sleep(1000)
    return claim()
  }
  const room = liveRuns().length < limit
  if (room) {
    mkdirSync(path.join(dir, "logs"), { recursive: true })
    await Bun.write(path.join(dir, "pid"), String(process.pid))
  }
  rmSync(lock, { recursive: true, force: true })
  if (room) return
  console.error(`${limit} runs are running; waiting for one to stop`)
  await Bun.sleep(30_000)
  return claim()
}
await claim()

const children: Array<number> = []
const log = (file: string) => openSync(path.join(dir, "logs", file), "a")
const start = (file: string, command: ReadonlyArray<string>, cwd: string, env: Record<string, string>) => {
  const child = spawn(command[0] ?? "", command.slice(1), {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", log(file), log(file)],
  })
  child.unref()
  if (child.pid) children.push(child.pid)
  return child.pid ?? 0
}
const signal = (pid: number, name: string) => Bun.spawnSync(["kill", `-${name}`, "--", `-${pid}`])

let stopping: Promise<never> | undefined
const stop = (code: number) =>
  (stopping ??= (async () => {
    for (const pid of children) signal(pid, "TERM")
    await until("stopping", async () => !children.some(alive), 15).catch(() => {
      for (const pid of children) signal(pid, "KILL")
    })
    await removeRun(name, e2bKey)
    process.exit(code)
  })())
process.once("SIGTERM", () => void stop(0))
process.once("SIGINT", () => void stop(0))

const ports = {
  server: freePort(),
  app: freePort(),
  hook: freePort(),
  tunnel: freePort(),
  control: freePort(),
  http: freePort(),
  https: freePort(),
  metrics: freePort(),
  postgres: freePort(),
  drive: freePort(),
}

const sandboxIdFile = "/run/e2b/.E2B_SANDBOX_ID"
const sandboxId = existsSync(sandboxIdFile) ? readFileSync(sandboxIdFile, "utf8").trim() : undefined

const ngrokConfig = path.join(home, "ngrok.yml")
const ngrokAgent = async () => {
  const wanted = `version: "3"\nagent:\n  authtoken: ${ngrokToken}\n  web_addr: 127.0.0.1:4040\n`
  const current = existsSync(ngrokConfig) ? readFileSync(ngrokConfig, "utf8") : ""
  const up = await answers(`${ngrokApi}/tunnels`)()
  if (up && current === wanted) return
  const pidFile = path.join(home, "ngrok.pid")
  if (up && existsSync(pidFile)) signal(Number(readFileSync(pidFile, "utf8")), "TERM")
  await until("the old ngrok agent to stop", async () => !(await answers(`${ngrokApi}/tunnels`)()), 15)
  await Bun.write(ngrokConfig, wanted)
  const agent = spawn(
    "ngrok",
    ["start", "--none", "--config", ngrokConfig, "--log", "stdout", "--log-format", "json"],
    {
      detached: true,
      stdio: ["ignore", openSync(path.join(home, "ngrok.log"), "a"), openSync(path.join(home, "ngrok.log"), "a")],
    },
  )
  agent.unref()
  await Bun.write(pidFile, String(agent.pid ?? 0))
  await until("the ngrok agent", answers(`${ngrokApi}/tunnels`), 30)
}

const Tunnel = Schema.Struct({ public_url: Schema.String })
const tunnel = async (suffix: string, proto: "tcp" | "http", port: number) => {
  const response = await fetch(`${ngrokApi}/tunnels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `${name}${suffix}`, proto, addr: `127.0.0.1:${port}` }),
  })
  if (!response.ok) throw new Error(`ngrok ${proto} tunnel: ${response.status} ${await response.text()}`)
  return Schema.decodeUnknownSync(Tunnel)(await response.json()).public_url
}
const publicUrl = (suffix: string, port: number) =>
  sandboxId ? Promise.resolve(`https://${port}-${sandboxId}.e2b.app`) : tunnel(suffix, "http", port)

const trustSandboxEgress = async () => {
  const caFile = path.join(os.homedir(), ".ren/egress-ca.pem")
  if (existsSync(caFile) && !existsSync("/usr/local/share/ca-certificates/ren-egress.crt"))
    await must(
      "trusting the sandbox egress CA",
      `sudo cp ${caFile} /usr/local/share/ca-certificates/ren-egress.crt && sudo update-ca-certificates && sudo systemctl restart docker`,
    )
}

const storageUp = async () => {
  const docker = await compose()
  const composeFile = path.join(dir, "compose.yaml")
  await Bun.write(
    composeFile,
    `services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: ren, POSTGRES_PASSWORD: ren, POSTGRES_DB: ren }
    ports: ["127.0.0.1:${ports.postgres}:5432"]
  rustfs:
    image: rustfs/rustfs:1.0.0-rc.6
    environment: { RUSTFS_ACCESS_KEY: ${storage.accessKeyId}, RUSTFS_SECRET_KEY: ${storage.secretAccessKey} }
    ports: ["127.0.0.1:${ports.drive}:9000"]
`,
  )
  await must("starting Postgres and the drive store", `${docker} -p ${name} -f ${composeFile} up -d`)
  await until(
    "Postgres",
    async () =>
      (await sh(`${docker} -p ${name} -f ${composeFile} exec -T postgres pg_isready -h 127.0.0.1 -U ren -d ren`))
        .exitCode === 0,
    90,
  )
  await until("the drive store", listening(ports.drive), 60)
  await Promise.all(
    ["ren-drives", "ren-bundles"].map((bucket) =>
      must(
        `creating the bucket ${bucket}`,
        `${docker.replace(/-compose$| compose$/, "")} run --rm --network ${name}_default -e AWS_ACCESS_KEY_ID=${storage.accessKeyId} -e AWS_SECRET_ACCESS_KEY=${storage.secretAccessKey} -e AWS_DEFAULT_REGION=us-east-1 amazon/aws-cli:2.31.19 s3api create-bucket --bucket ${bucket} --endpoint-url http://rustfs:9000`,
      ),
    ),
  )

  const database = `postgres://ren:ren@127.0.0.1:${ports.postgres}/ren`
  await must("migrating", "bun run db migrate", path.join(repository, "packages/db"), { DATABASE_URL: database })
  await must("seeding Ren's settings", "bun script/ren-settings.ts", path.join(repository, "packages/core"), {
    DATABASE_URL: database,
  })
  return database
}

const egressUp = async () => {
  const egressSource = path.join(repository, "repos/iron-proxy")
  const certs = path.join(egressSource, ".dev/certs")
  if (!existsSync(path.join(certs, "leaf.pem"))) await must("egress certificates", "bun run certificates", egressSource)
  const dirty = (await sh("git status --porcelain -- repos/iron-proxy")).stdout.toString().trim().length > 0
  const tree = (await must("the egress source hash", "git rev-parse HEAD:repos/iron-proxy")).trim()
  const egress = dirty ? path.join(dir, "egress") : path.join(home, "egress", tree)
  if (!existsSync(egress))
    await must(
      "building the egress",
      `bun ${repository}/script/memory.ts queue --mib=1024 -- go build -o ${egress} ./cmd/iron-proxy`,
      egressSource,
      { GOTOOLCHAIN: "auto", CGO_ENABLED: "0" },
    )
  const egressConfig = path.join(dir, "egress.yaml")
  await Bun.write(
    egressConfig,
    `dns:
  enabled: false
proxy:
  http_listen: "127.0.0.1:${ports.http}"
  https_listen: "127.0.0.1:${ports.https}"
  tunnel_listen: "127.0.0.1:${ports.tunnel}"
  upstream_deny_cidrs: ["127.0.0.0/8", "169.254.0.0/16", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "::1/128", "fc00::/7"]
  upstream_response_header_timeout: "5m"
tls:
  ca_cert: "${certs}/mitm-ca.pem"
  ca_key: "${certs}/mitm-ca.key"
metrics:
  listen: "127.0.0.1:${ports.metrics}"
ren:
  hook: "https://127.0.0.1:${ports.hook}"
  ca_cert: "${certs}/ca.pem"
  cert: "${certs}/leaf.pem"
  key: "${certs}/leaf.key"
  control_listen: "127.0.0.1:${ports.control}"
`,
  )
  start("egress.log", [egress, "--config", egressConfig], dir, { PATH: process.env.PATH ?? "" })
  await until("the egress", listening(ports.tunnel), 30)
  return { certs, egressPublic: (await tunnel("", "tcp", ports.tunnel)).replace("tcp://", "") }
}

const brainImage = async () => {
  const templateLock = path.join(home, "template.lock")
  await until("the template lock", async () => Bun.spawnSync(["mkdir", templateLock]).exitCode === 0, 900)
  const staged = await sh("bun e2b/stage.ts", path.join(repository, "packages/cell"), {
    E2B_TEMPLATE_NAME: "ren-e2e-brain",
    E2B_TEMPLATE_OWNER: "ren-e2e",
  }).finally(() => rmSync(templateLock, { recursive: true, force: true }))
  await Bun.write(path.join(dir, "logs/template.log"), staged.stdout)
  const template = /^E2B_TEMPLATE=(\S+)|^(\S+) exists/m.exec(staged.stdout.toString())
  const templateTag = template?.[1] ?? template?.[2]
  if (staged.exitCode !== 0 || !templateTag)
    throw new Error(`The brain image did not build:\n${staged.stderr.toString()}`)
  return templateTag
}

const bundlesUp = async () => {
  const bundles = path.join(dir, "bundles")
  await must("building the bundles", `bun packages/cell/machine/bundle.ts ${bundles}`)
  const s3 = new S3Client({ ...storage, endpoint: `http://127.0.0.1:${ports.drive}`, bucket: "ren-bundles" })
  const files = readdirSync(bundles, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(bundles, path.join(entry.parentPath, entry.name)))
  await Promise.all(
    files
      .filter((file) => file !== "current.json")
      .map((file) => s3.write(`bundles/${file}`, Bun.file(path.join(bundles, file)))),
  )
  await s3.write("bundles/current.json", Bun.file(path.join(bundles, "current.json")))
}

const main = async () => {
  await trustSandboxEgress()
  await ngrokAgent()
  const database = await storageUp()
  const egress = await egressUp()
  const templateTag = await brainImage()
  await bundlesUp()
  const [renUrl, driveUrl] = await Promise.all([publicUrl("-server", ports.server), publicUrl("-drive", ports.drive)])
  const encode = (key: Signature.PrivateKey) =>
    JSON.stringify([{ id: key.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key) }])
  const brain = await Effect.runPromise(Signature.generate("e2e-brain"))
  const environment = await Effect.runPromise(Signature.generate("e2e-environment"))
  const envelope = JSON.stringify([
    { id: "local:e2e", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
  ])
  const slack = Object.fromEntries(
    ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key] ?? ""]] : [],
    ),
  )
  const appOrigin = `http://127.0.0.1:${ports.app}`
  const serverEnv = {
    PATH: process.env.PATH ?? "",
    HOME: os.homedir(),
    PORT: String(ports.server),
    DATABASE_URL: database,
    NODE_ENV: "development",
    BETTER_AUTH_SECRET: crypto.randomUUID(),
    BETTER_AUTH_URL: `http://127.0.0.1:${ports.server}`,
    TRUSTED_ORIGINS: appOrigin,
    APP_URL: `${appOrigin}/app`,
    SKIP_EMAIL_VERIFICATION: "true",
    SIGNUP_MX_CHECK: "false",
    GOOGLE_CLIENT_ID: "e2e",
    GOOGLE_CLIENT_SECRET: "e2e",
    DRIVE_ENDPOINT: driveUrl,
    DRIVE_BUCKET: "ren-drives",
    DRIVE_ACCESS_KEY_ID: storage.accessKeyId,
    DRIVE_SECRET_ACCESS_KEY: storage.secretAccessKey,
    DRIVE_ROLE_ARN: "arn:aws:iam::000000000000:role/drive",
    BUNDLE_BUCKET: "ren-bundles",
    BUNDLE_ENDPOINT: driveUrl,
    BUNDLE_ACCESS_KEY_ID: storage.accessKeyId,
    BUNDLE_SECRET_ACCESS_KEY: storage.secretAccessKey,
    SANDBOX_PROVIDER: "e2b",
    E2B_API_KEY: e2bKey,
    E2B_TEMPLATE: templateTag,
    E2B_OWNER: name,
    E2B_VCPU_SECOND_MICRO_USD: "14",
    E2B_GIB_SECOND_MICRO_USD: "4.5",
    REN_URL: renUrl,
    REN_INFERENCE_GATEWAY_URL: gateway,
    REN_INFERENCE_GATEWAY_KEY: gatewayKey,
    EGRESS_PROXY_ADDRESS: egress.egressPublic,
    EGRESS_CA_FILE: `${egress.certs}/mitm-ca.pem`,
    EGRESS_PORT: String(ports.hook),
    EGRESS_TLS_CERT: `${egress.certs}/leaf.pem`,
    EGRESS_TLS_KEY: `${egress.certs}/leaf.key`,
    EGRESS_TLS_CA: `${egress.certs}/ca.pem`,
    EGRESS_CONTROL_URLS: `https://127.0.0.1:${ports.control}`,
    EGRESS_CONTROL_TLS_CERT: `${egress.certs}/leaf.pem`,
    EGRESS_CONTROL_TLS_KEY: `${egress.certs}/leaf.key`,
    EGRESS_CONTROL_TLS_CA: `${egress.certs}/ca.pem`,
    ENVELOPE_KEYS: envelope,
    BRAIN_KEYS: encode(brain.privateKey),
    ENVIRONMENT_KEYS: encode(environment.privateKey),
    ...slack,
  }
  const queue = (mib: number, command: ReadonlyArray<string>) => [
    "bun",
    path.join(repository, "script/memory.ts"),
    "queue",
    `--mib=${mib}`,
    "--",
    ...command,
  ]
  start("server.log", queue(512, ["bun", "run", "src/main.ts"]), path.join(repository, "packages/server"), serverEnv)
  start(
    "app.log",
    queue(1536, ["bun", "run", "dev", "--host", "127.0.0.1", "--port", String(ports.app), "--strictPort"]),
    path.join(repository, "packages/app"),
    { PATH: process.env.PATH ?? "", HOME: os.homedir(), VITE_REN_API_URL: `http://127.0.0.1:${ports.server}` },
  )
  await until("the server", answers(`http://127.0.0.1:${ports.server}/health`), 180)
  await until("the server's public address", answers(`${renUrl}/health`), 60)
  await until("the app", answers(`${appOrigin}/app/`), 180)

  const runEnv = {
    RUN: name,
    RUN_DIR: dir,
    W: repository,
    APP_URL: `${appOrigin}/app/`,
    SERVER_URL: `http://127.0.0.1:${ports.server}`,
    REN_URL: renUrl,
    DATABASE_URL: database,
    ENVELOPE_KEYS: envelope,
    DRIVE_ENDPOINT: driveUrl,
    E2B_OWNER: name,
    EGRESS_PUBLIC: egress.egressPublic,
    LOGS: path.join(dir, "logs"),
  }
  await Bun.write(
    path.join(dir, "run.env"),
    Object.entries(runEnv)
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n"),
  )
  console.log(`ready ${path.join(dir, "run.env")}`)
}

await main().catch(async (error: unknown) => {
  console.error(error)
  await stop(1)
})
await new Promise(() => undefined)
