import { afterAll, describe, expect, test } from "bun:test"
import { BunCrypto } from "@effect/platform-bun"
import { PgClient } from "@effect/sql-pg"
import { Access } from "@ren/core/access"
import { BrainClient } from "@ren/core/brain-client"
import { BrainHost } from "@ren/core/brain-host"
import { BrainLifecycle } from "@ren/core/brain-lifecycle"
import { BrainRegistry } from "@ren/core/brain-registry"
import { Brains } from "@ren/core/brains"
import { CredentialCallers } from "@ren/core/credential-callers"
import { CredentialEnv } from "@ren/core/credential-env"
import { DurableRunner } from "@ren/core/durable-runner"
import { EgressControl } from "@ren/core/egress-control"
import { Envelope } from "@ren/core/envelope"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Environments } from "@ren/core/environments"
import { Models } from "@ren/core/models"
import { SandboxEgress } from "@ren/core/sandbox-egress"
import { SandboxProvider } from "@ren/core/sandbox-provider"
import { E2BSandbox } from "@ren/core/sandbox-provider/e2b"
import { SessionRunner } from "@ren/core/session/runner"
import { Settings } from "@ren/core/settings"
import { Signer } from "@ren/core/signer"
import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { TestEnvironment } from "@ren/executor/testing"
import { EgressHarness } from "@ren/server/testing"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { Space } from "@ren/schema/space"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import path from "node:path"
import { Platform } from "../lib/platform.js"
import { LiteLLM } from "../lib/provider/litellm.js"
import { Wait } from "../lib/wait.js"

// oxlint-disable-next-line ren/no-comments -- The E2B brain reaches the real Ren server and LiteLLM through public tunnels to these local ports.
const renPort = Number(process.env.CHAOS_REN_TUNNEL_PORT ?? 4111)
const renTunnel = process.env.CHAOS_REN_TUNNEL_URL ?? ""
const litellmTunnel = process.env.CHAOS_LITELLM_TUNNEL_URL ?? ""
const template = process.env.CHAOS_E2B_TEMPLATE ?? ""
const root = path.resolve(import.meta.dir, "../../..")
const adminUrl = process.env.DATABASE_URL ?? "postgres://ren:ren@localhost:54320/ren"
const small = "anthropic/claude-haiku-5-5"
// oxlint-disable-next-line ren/no-comments -- The egress's tunnel port and its public TCP address (for example an ngrok TCP tunnel to that port); E2B sends all sandbox traffic there.
const egressPort = Number(process.env.CHAOS_EGRESS_PORT ?? 4222)
const egressPublic = process.env.CHAOS_EGRESS_PUBLIC ?? ""

const unmet =
  Platform.e2b ??
  Platform.litellm ??
  (renTunnel && litellmTunnel && template ? undefined : "needs CHAOS_REN_TUNNEL_URL and CHAOS_LITELLM_TUNNEL_URL") ??
  (egressPublic ? undefined : "needs CHAOS_EGRESS_PUBLIC: an E2B brain always runs behind the egress")

const encoded = (key: Signature.PrivateKey) =>
  JSON.stringify([{ id: key.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key) }])

describe.skipIf(unmet !== undefined)("hot reload through the real Ren server to a running E2B brain", () => {
  const cleanups: Array<() => Promise<unknown>> = []

  afterAll(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) await cleanup().catch(() => undefined)
  }, 180_000)

  // oxlint-disable-next-line ren/no-comments -- Behind the egress the brain holds no model key: it sends ren:MODELS, and the egress puts in the key Ren mints (C8, HR29).
  const behindEgress = async () => {
    const certificates = await EgressHarness.certificates()
    cleanups.push(() => EgressHarness.cleanup(certificates))
    const hookPort = EgressHarness.freePort()
    const egress = await EgressHarness.start({
      binary: await EgressHarness.build(),
      certificates,
      hook: `https://localhost:${hookPort}`,
      tunnelPort: egressPort,
      upstreamResolver: "1.1.1.1:53",
    })
    cleanups.push(() => egress.stop())
    return {
      ENVELOPE_KEYS: JSON.stringify([
        { id: "local:e2b", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
      ]),
      EGRESS_PROXY_ADDRESS: egressPublic,
      EGRESS_CA_FILE: certificates.mitmCa,
      EGRESS_PORT: String(hookPort),
      EGRESS_TLS_CERT: certificates.serverCert,
      EGRESS_TLS_KEY: certificates.serverKey,
      EGRESS_TLS_CA: certificates.ca,
      EGRESS_CONTROL_URLS: `https://127.0.0.1:${egress.control}`,
      EGRESS_CONTROL_TLS_CERT: certificates.clientCert,
      EGRESS_CONTROL_TLS_KEY: certificates.clientKey,
      EGRESS_CONTROL_TLS_CA: certificates.ca,
    }
  }

  const pushReaches = async (egress: Readonly<Record<string, string>> | undefined) => {
    const name = `ren_e2e_${crypto.randomUUID().replaceAll("-", "")}`
    const admin = new Bun.SQL(adminUrl)
    await admin.unsafe(`CREATE DATABASE "${name}"`)
    cleanups.push(() => admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`))
    const database = new URL(adminUrl)
    database.pathname = `/${name}`
    const migrate = Bun.spawn(["bun", "run", "db", "migrate"], {
      cwd: path.join(root, "db"),
      env: { ...process.env, DATABASE_URL: database.href },
      stdout: "ignore",
      stderr: "inherit",
    })
    expect(await migrate.exited).toBe(0)
    const direct = new Bun.SQL(database.href)
    const databaseLayer = Database.layer.pipe(Layer.provideMerge(PgClient.layer({ url: Redacted.make(database.href) })))
    const seeded = ManagedRuntime.make(Layer.mergeAll(Access.layer).pipe(Layer.provideMerge(databaseLayer)))
    cleanups.push(() => seeded.dispose())
    const owner = await seeded.runPromise(Seed.owner())
    await seeded.runPromise(Seed.ren())
    await direct`UPDATE space SET brain_scope = 'session' WHERE id = ${owner.spaceId}`
    await direct`INSERT INTO space_member (id, space_id, user_id) VALUES (${Space.MembershipID.create()}, ${owner.spaceId}, ${owner.createdBy})`
    await direct`
      INSERT INTO settings (space_id, settings)
      VALUES (${owner.spaceId}, ${JSON.stringify({ model: { endpointId: "anthropic", modelId: "claude-haiku-5-5" }, permissions: [], references: [] })}::text::jsonb)`

    const key = await LiteLLM.generate({ duration: "2h", models: [small] })
    cleanups.push(() => LiteLLM.remove(key))
    const brainKey = await Effect.runPromise(Signature.generate("e2b-server"))
    const shared = {
      BRAIN_KEYS: encoded(brainKey.privateKey),
      ENVIRONMENT_KEYS: encoded(TestEnvironment.keys.privateKey),
      REN_URL: renTunnel,
      E2B_TEMPLATE: template,
      REN_LITELLM_URL: LiteLLM.url,
      REN_LITELLM_BRAIN_URL: litellmTunnel,
      REN_LITELLM_KEY: key,
      ENVELOPE_KEYS: JSON.stringify([
        { id: "local:e2b", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
      ]),
      ...egress,
    }

    // oxlint-disable-next-line ren/no-comments -- The tunnel's port forwards to the real server and counts the brain's pulls.
    const pulls: Array<number> = []
    const serverPort = await (async () => {
      const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
      const found = Number(probe.url.port)
      await probe.stop(true)
      return found
    })()
    const front = Bun.serve({
      hostname: "127.0.0.1",
      port: renPort,
      fetch: (request) => {
        const url = new URL(request.url)
        if (request.method === "POST" && url.pathname === "/host/pull") pulls.push(Date.now())
        return fetch(`http://127.0.0.1:${serverPort}${url.pathname}${url.search}`, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: "manual",
        })
      },
    })
    cleanups.push(() => front.stop(true))
    const server = Bun.spawn(["bun", "run", "src/main.ts"], {
      cwd: path.join(root, "server"),
      env: {
        ...process.env,
        ...shared,
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
        SANDBOX_PROVIDER: "e2b",
      },
      stdout: "ignore",
      stderr: "inherit",
    })
    cleanups.push(async () => {
      server.kill("SIGKILL")
      await server.exited
    })
    await Wait.until("the Ren server to answer /health", 60_000, async () => {
      const response = await fetch(`http://127.0.0.1:${serverPort}/health`).catch(() => undefined)
      return response?.ok ? true : undefined
    })

    // oxlint-disable-next-line ren/no-comments -- The test process starts the brain (it has no signed-in user for the server's API); every pull and push of that brain goes through the real server.
    const core = ManagedRuntime.make(
      SessionRunner.layer.pipe(
        Layer.provideMerge(BrainRegistry.layer),
        Layer.provideMerge(
          Brains.layer.pipe(
            Layer.provide(CredentialEnv.layerNone),
            Layer.provideMerge(BrainHost.layerSandbox),
            Layer.provideMerge(
              BrainLifecycle.layer.pipe(
                Layer.provide(
                  egress
                    ? SandboxEgress.layer.pipe(
                        Layer.provide(Layer.mergeAll(CredentialCallers.layer, EgressControl.layerConfig)),
                        Layer.provide(Layer.mergeAll(Envelope.layerLocal, Signer.layerLocal)),
                      )
                    : SandboxEgress.layerNone,
                ),
              ),
            ),
            Layer.provideMerge(E2BSandbox.layer),
            Layer.provideMerge(DurableRunner.layerEffect.pipe(Layer.provide(BunCrypto.layer))),
            Layer.provideMerge(BrainClient.layer.pipe(Layer.provide(Signer.layerLocal))),
            Layer.provide(Settings.layer),
            Layer.provide(Models.layerLiteLLM),
            Layer.provide(
              Environments.layer
                .pipe(Layer.provide(Signer.layerLocal))
                .pipe(Layer.provide(EnvironmentProvider.layer<never, never>([]))),
            ),
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ...shared, ...process.env }))),
          ),
        ),
        Layer.provideMerge(databaseLayer),
      ),
    )
    cleanups.push(() => core.dispose())
    const sessionId = Session.ID.create()
    await core.runPromise(
      SessionRunner.Service.use((sessions) =>
        sessions.create(owner, {
          sessionId,
          harness: "opencode",
          interactive: false,
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text: "Reply with the word READY only." },
            sender: { userId: owner.createdBy },
          },
        }),
      ),
    )
    const brainId = Brain.ofSession(sessionId)
    cleanups.push(async () => {
      const rows = await direct`SELECT binding FROM brain WHERE id = ${brainId}`
      const binding = rows.at(0)?.binding
      if (binding) await core.runPromise(SandboxProvider.Service.use((provider) => provider.destroy(binding)))
    })
    await Wait.until(`the E2B brain of ${sessionId} to be ready`, 300_000, async () => {
      const found = await core.runPromise(
        Brains.Service.use((brains) => brains.access(sessionId, { userId: owner.createdBy, memberId: owner.memberId })),
      )
      if (found.status === "failed") throw new Error(`the brain failed: ${found.reason}`)
      return found.status === "ready" ? true : undefined
    })
    await Wait.until("the brain's first pull from the real server", 120_000, async () =>
      pulls.length > 0 ? true : undefined,
    )

    // oxlint-disable-next-line ren/no-comments -- An E2B brain also pulls every 30 s by itself. A pull within 3 s of each of three writes comes from the push: three timer pulls in those windows have a chance near 1 in 1000.
    const delays: Array<number> = []
    for (const instructions of ["Pushed once.", "Pushed twice.", "Pushed three times."]) {
      // oxlint-disable-next-line no-await-in-loop -- each write waits for its own pull
      await Wait.until("the brain to be quiet", 30_000, async () =>
        pulls.length === 0 || Date.now() - (pulls.at(-1) ?? 0) > 3_000 ? true : undefined,
      )
      const written = Date.now()
      // oxlint-disable-next-line no-await-in-loop -- one write at a time
      await direct`
        UPDATE settings SET settings = ${JSON.stringify({ model: { endpointId: "anthropic", modelId: "claude-haiku-5-5" }, instructions, permissions: [], references: [] })}::text::jsonb
        WHERE space_id = ${owner.spaceId}`
      // oxlint-disable-next-line no-await-in-loop -- one write at a time
      const pulled = await Wait.until("a pull after the write", 20_000, async () => pulls.find((at) => at >= written))
      delays.push(pulled - written)
    }
    expect(delays.every((delay) => delay < 3_000)).toBe(true)
    const answered =
      await direct`SELECT count(*)::int AS count FROM opencode_message WHERE session_id = ${sessionId} AND type = 'assistant'`
    return { answered: answered.at(0)?.count ?? 0 }
  }

  test("behind the egress, the E2B brain answers with the key the egress puts in, and a settings write still reaches it by push", async () => {
    expect((await pushReaches(await behindEgress())).answered).toBeGreaterThan(0)
  }, 900_000)
})
