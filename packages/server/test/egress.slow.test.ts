import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { Access } from "@ren/core/access"
import { BrainClient } from "@ren/core/brain-client"
import { CredentialCallers } from "@ren/core/credential-callers"
import { CredentialRefresh } from "@ren/core/credential-refresh"
import { CredentialSource } from "@ren/core/credential-source"
import { Credentials } from "@ren/core/credentials"
import { DurableRunner } from "@ren/core/durable-runner"
import { Egress } from "@ren/core/egress"
import { EgressControl } from "@ren/core/egress-control"
import { Envelope } from "@ren/core/envelope"
import { GitHubApp } from "@ren/core/github-app"
import { OAuthFetch } from "@ren/core/oauth-fetch"
import { AppProfiles } from "@ren/core/app/profiles"
import { Models } from "@ren/core/models"
import { Signer } from "@ren/core/signer"
import { GitHubServer, Seed, testEffect } from "@ren/core/testing"
import { Testing } from "@ren/db/testing"
import { BrainToken } from "@ren/host-api/brain-token"
import { HostMcp } from "@ren/host-api/host-mcp"
import { EnvironmentConnections } from "@ren/brain/environment/connections"
import { EnvironmentSession } from "@ren/brain/environment/session"
import { GitHubReader } from "@ren/brain/github/reader"
import { SkillSource } from "@ren/brain/skill/source"
import { TestAccess, TestGitHub } from "@ren/brain/testing"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { TestEnvironment } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { ChannelInstall } from "@ren/schema/channel-install"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Signature } from "@ren/schema/signature"
import { Database } from "@ren/db/database"
import { Credential } from "@ren/schema/credential"
import { App } from "@ren/schema/app"
import { AppProfile } from "@ren/schema/app-profile"
import { eq } from "drizzle-orm"
import { ConfigProvider, Context, Deferred, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EgressRoutes } from "../src/egress.js"
import { EgressHarness } from "./lib/egress.js"

setDefaultTimeout(120_000)

const brainKey = await Effect.runPromise(Signature.generate("brain"))

const seen: Array<{
  readonly host: string
  readonly path: string
  readonly query: string
  readonly authorization: string | null
  readonly chat: ReadonlyArray<string | null>
  readonly body: string
}> = []

const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url)
    seen.push({
      host: request.headers.get("host") ?? "",
      path: url.pathname,
      query: url.search,
      authorization: request.headers.get("authorization"),
      chat: [request.headers.get(HostMcp.sessionHeader), request.headers.get(HostMcp.userHeader)],
      body: await request.text(),
    })
    if (url.pathname === "/mcp" && request.headers.get("authorization") === "Bearer tok_old")
      return new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer error="invalid_token"' } })
    if (url.pathname === "/redirect") return Response.redirect(`http://other.test:${url.port}/landing`, 302)
    if (url.pathname === "/events")
      return new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode("data: one\n\n"))
            controller.enqueue(new TextEncoder().encode("data: two\n\n"))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    if (url.pathname === "/hold") return new Response(new ReadableStream({ start: () => {} }))
    return Response.json({ authorization: request.headers.get("authorization"), query: url.search })
  },
})

const githubApp = GitHubServer.start()

const refreshed = Deferred.makeUnsafe<void>()

// oxlint-disable-next-line ren/no-comments -- Stands in for the provider's token endpoint; the OAuth refresher has its own tests against a local authorization server.
const refreshers = Layer.succeed(
  CredentialRefresh.Refreshers,
  new Map([
    [
      "oauth" as const,
      {
        refresh: () =>
          Effect.succeed(
            Option.some({
              value: { type: "oauth" as const, accessToken: Redacted.make("tok_new") },
              expiresAt: Option.none(),
              saved: Deferred.succeed(refreshed, undefined).pipe(Effect.asVoid),
            }),
          ),
      },
    ],
  ]),
)

const state: {
  certificates?: EgressHarness.Certificates
  binary?: string
  egress?: EgressHarness.Instance
  renPort: number
} = { renPort: EgressHarness.freePort() }

beforeAll(async () => {
  state.certificates = await EgressHarness.certificates()
  state.binary = await EgressHarness.build()
}, 600_000)

afterAll(async () => {
  await state.egress?.stop()
  await upstream.stop(true)
  githubApp.stop()
  if (state.certificates) await EgressHarness.cleanup(state.certificates)
})

const certificates = () => {
  if (!state.certificates) throw new Error("certificates were not made")
  return state.certificates
}

const ren = () => {
  const certs = certificates()
  return EgressRoutes.serve.pipe(
    Layer.provideMerge(Egress.layer),
    Layer.provideMerge(AppProfiles.layer),
    Layer.provideMerge(CredentialRefresh.layer),
    Layer.provideMerge(Layer.mergeAll(refreshers, DurableRunner.layerMemory)),
    Layer.provideMerge(CredentialSource.layer),
    Layer.provideMerge(
      Layer.mergeAll(CredentialSource.layerStatic, CredentialSource.layerMinted, CredentialSource.layerProvider),
    ),
    Layer.provideMerge(
      Layer.mergeAll(Credentials.layer, CredentialCallers.layer, BrainClient.layer, Models.layerNone, GitHubApp.layer),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        Access.layer,
        Envelope.layerLocal,
        EgressControl.layerHttp,
        Signer.layerLocal,
        OAuthFetch.layerUnchecked,
      ),
    ),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
          BRAIN_KEYS: JSON.stringify([
            {
              id: brainKey.privateKey.id,
              key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(brainKey.privateKey.key),
            },
          ]),
          REN_URL: `http://ren.test:${upstream.port}`,
          EGRESS_PORT: String(state.renPort),
          EGRESS_TLS_CERT: certs.serverCert,
          EGRESS_TLS_KEY: certs.serverKey,
          EGRESS_TLS_CA: certs.ca,
          EGRESS_CONTROL_URLS: `https://127.0.0.1:${state.egress?.control ?? 0}`,
          EGRESS_CONTROL_TLS_CERT: certs.clientCert,
          EGRESS_CONTROL_TLS_KEY: certs.clientKey,
          EGRESS_CONTROL_TLS_CA: certs.ca,
          ...GitHubServer.config(githubApp.url, { GITHUB_URL: "http://github.com" }),
        }),
      ),
    ),
  )
}

const egress = async () => {
  if (!state.egress) {
    if (!state.binary) throw new Error("the egress was not built")
    state.egress = await EgressHarness.start({
      binary: state.binary,
      certificates: certificates(),
      hook: `https://localhost:${state.renPort}`,
    })
  }
  return state.egress
}

const it = testEffect(Layer.unwrap(Effect.promise(() => egress().then(ren))))

const setup = Effect.fnUntraced(function* () {
  const callers = yield* CredentialCallers.Service
  const credentials = yield* Credentials.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* Seed.actor(organizationId, "member")
  const spaceId = yield* Seed.space(organizationId)
  const brainId = Brain.ID.create()
  yield* Seed.session({ organizationId, spaceId, createdBy: ada.userId, brainId })
  yield* credentials.create(ada, {
    owner: { kind: "org" },
    label: "STRIPE_API_KEY",
    hosts: ["api.stripe.test"],
    value: { type: "key", value: Redacted.make("sk_live_real") },
    inject: { op: "replace", in: ["header", "query"] },
  })
  const placement = yield* callers.issue(
    { workload: { kind: "brain", id: brainId, generation: 1 }, organizationId },
    "ProxyLogin",
  )
  if (placement.kind !== "ProxyLogin") return yield* Effect.die(new Error("expected a proxy login"))
  return { brainId, organizationId, login: placement.username, password: Redacted.value(placement.password) }
})

const socks = (login: string, password: string) =>
  `--proxy socks5h://${login}:${password}@127.0.0.1:${state.egress?.tunnel ?? 0}`

const http = (login: string, password: string) =>
  `--proxy http://${login}:${password}@127.0.0.1:${state.egress?.tunnel ?? 0}`

const at = (path: string, host = "api.stripe.test") => `'http://${host}:${upstream.port}${path}'`

// oxlint-disable-next-line ren/no-comments -- profiles.md §1: two profiles of one app that a space reaches, each with its own sign-in, and one profile the space does not reach.
const profiles = Effect.fnUntraced(function* (found: Effect.Success<ReturnType<typeof setup>>) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const spaceId = (yield* database.db
    .select({ spaceId: Database.Schema.brain.space_id })
    .from(Database.Schema.brain)
    .where(eq(Database.Schema.brain.id, found.brainId))).at(0)?.spaceId
  if (!spaceId) return yield* Effect.die(new Error("expected the brain's space"))
  const appId = App.ID.create()
  yield* database.db.insert(Database.Schema.app).values({
    id: appId,
    slug: `mail-${appId.slice(-6).toLowerCase()}`,
    name: "Mail",
    description: "Mail",
    required_credentials: [],
    skills: {},
    mcps: {
      gmail: {
        name: "Gmail",
        description: "Gmail",
        transport: { type: "remote", url: "https://mail.test/mcp" },
        auth: { type: "oauth", tokenEndpointAuth: "none" },
        requiredCredentials: [],
      },
    },
  })
  yield* Effect.forEach(
    [
      { slug: "acme", listed: true },
      { slug: "globex", listed: true },
      { slug: "other", listed: false },
    ],
    Effect.fnUntraced(function* (entry) {
      const profileId = AppProfile.ID.create()
      yield* database.db.insert(Database.Schema.app_profile).values({
        id: profileId,
        organization_id: found.organizationId,
        app_id: appId,
        slug: entry.slug,
        name: entry.slug,
        kind: "shared",
      })
      if (entry.listed)
        yield* database.db
          .insert(Database.Schema.app_profile_space)
          .values({ profile_id: profileId, space_id: spaceId })
      const id = Credential.ID.create()
      const value = yield* envelope.seal(
        Redacted.make(JSON.stringify({ type: "oauth", accessToken: `tok_${entry.slug}` })),
        { organizationId: found.organizationId, kind: "credential", id },
      )
      yield* database.db.insert(Database.Schema.credential).values({
        id,
        organization_id: found.organizationId,
        owner: "profile",
        profile_id: profileId,
        label: `MCP_GMAIL__${entry.slug.toUpperCase()}`,
        type: "oauth",
        value,
        hosts: ["mail.test"],
        inject: { op: "replace", in: ["header"] },
      })
    }),
  )
})

describe("egress (iron-proxy fork) with Ren", () => {
  it.live("two profiles of one app: each server's placeholder reaches the upstream with its own token", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      yield* profiles(found)
      const call = (label: string) =>
        Effect.promise(() =>
          EgressHarness.curl([
            socks(found.login, found.password),
            "-H",
            `'Authorization: Bearer ren:${label}'`,
            at("/mcp-profile", "mail.test"),
          ]),
        )
      expect((yield* call("MCP_GMAIL__ACME")).status).toBe(200)
      expect(seen.findLast((request) => request.path === "/mcp-profile")?.authorization).toBe("Bearer tok_acme")
      expect((yield* call("MCP_GMAIL__GLOBEX")).status).toBe(200)
      expect(seen.findLast((request) => request.path === "/mcp-profile")?.authorization).toBe("Bearer tok_globex")
      const before = seen.length
      expect((yield* call("MCP_GMAIL__OTHER")).status).toBe(403)
      expect(seen.length).toBe(before)
    }),
  )

  it.live(
    "a process with only the placeholder reaches the upstream with the real key, over SOCKS5 and HTTP proxy",
    () =>
      Effect.gen(function* () {
        const found = yield* setup()
        const env = { STRIPE_API_KEY: "ren:STRIPE_API_KEY" }
        const viaSocks = yield* Effect.promise(() =>
          EgressHarness.curl(
            [socks(found.login, found.password), "-H", '"Authorization: Bearer $STRIPE_API_KEY"', at("/v1/charges")],
            env,
          ),
        )
        expect(viaSocks.status).toBe(200)
        expect(seen.findLast((request) => request.path === "/v1/charges")?.authorization).toBe("Bearer sk_live_real")
        expect(JSON.parse(viaSocks.body)).toMatchObject({ authorization: "Bearer ren:STRIPE_API_KEY" })
        const viaHttp = yield* Effect.promise(() =>
          EgressHarness.curl(
            [
              http(found.login, found.password),
              `"http://api.stripe.test:${upstream.port}/v1/charges?key=$STRIPE_API_KEY"`,
            ],
            env,
          ),
        )
        expect(seen.findLast((request) => request.path === "/v1/charges")?.query).toBe("?key=sk_live_real")
        expect(viaHttp.body).not.toContain("sk_live_real")
      }),
  )

  it.live("a JSON request body passes through the egress to the upstream unchanged", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const sent = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          "-H",
          "'Content-Type: application/json'",
          "-d",
          `'{"amount":42}'`,
          at("/v1/json"),
        ]),
      )
      expect(sent.status).toBe(200)
      expect(seen.findLast((request) => request.path === "/v1/json")?.body).toBe('{"amount":42}')
    }),
  )

  it.live("a POST with no body reaches the upstream with Content-Length 0, which Bun requires", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const sent = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, found.password), "-X", "POST", at("/v1/empty")]),
      )
      expect(sent.status).toBe(200)
    }),
  )

  it.live("a request with a label Ren does not have is not forwarded: 403 with the reason and the label", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const before = seen.length
      const denied = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, found.password), "-H", "'X-Api-Key: ren:MISSING'", at("/v1/charges")]),
      )
      expect(denied.status).toBe(403)
      expect(denied.head.toLowerCase()).toContain("x-ren-egress: credential_missing")
      expect(JSON.parse(denied.body)).toEqual({
        error: "ren_credential_missing",
        label: "MISSING",
      })
      expect(seen.length).toBe(before)
    }),
  )

  it.live("an upstream answers 401 once; the egress reports it, Ren refreshes, and the next request works", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const database = yield* Database.Service
      const envelope = yield* Envelope.Service
      const id = Credential.ID.create()
      const value = yield* envelope.seal(
        Redacted.make(
          Schema.encodeSync(Schema.fromJsonString(Credentials.Sealed))({
            type: "oauth",
            accessToken: Redacted.make("tok_old"),
          }),
        ),
        { organizationId: found.organizationId, kind: "credential", id },
      )
      yield* database.db.insert(Database.Schema.credential).values({
        id,
        organization_id: found.organizationId,
        owner: "org",
        label: "MCP_LINEAR",
        type: "oauth",
        value,
        hosts: ["mcp.linear.test"],
        inject: { op: "replace", in: ["header"] },
      })
      const call = () =>
        Effect.promise(() =>
          EgressHarness.curl([
            socks(found.login, found.password),
            "-H",
            "'Authorization: Bearer ren:MCP_LINEAR'",
            at("/mcp", "mcp.linear.test"),
          ]),
        )
      expect((yield* call()).status).toBe(401)
      yield* Deferred.await(refreshed)
      expect((yield* call()).status).toBe(200)
      expect(seen.findLast((request) => request.path === "/mcp")?.authorization).toBe("Bearer tok_new")
    }),
  )

  it.live("a wrong proxy login gets no tunnel", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const refused = yield* Effect.promise(() => EgressHarness.curl([http(found.login, "wrong"), at("/v1/charges")]))
      expect(refused.status).toBe(407)
      const socksRefused = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, "wrong"), at("/v1/charges")]),
      )
      expect(socksRefused.status).toBe(0)
    }),
  )

  it.live("a request for another host than the tunnel's target is refused, and no credential leaves", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const before = seen.length
      const refused = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          `'Host: other.test:${upstream.port}'`,
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/v1/charges"),
        ]),
      )
      expect(refused.status).toBe(403)
      expect(refused.head.toLowerCase()).toContain("x-ren-egress: host_mismatch")
      expect(seen.length).toBe(before)
    }),
  )

  it.live("the egress does not follow a redirect; the request to the other host gets no credential", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const first = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/redirect"),
        ]),
      )
      expect(first.status).toBe(302)
      const second = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/landing", "other.test"),
        ]),
      )
      expect(second.status).toBe(403)
      expect(second.head.toLowerCase()).toContain("x-ren-egress: host_not_allowed")
      expect(seen.some((request) => request.path === "/landing")).toBe(false)
    }),
  )

  it.live("a server-sent events stream gets the credential and every event", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const stream = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-N",
          "-H",
          "'Authorization: Bearer ren:STRIPE_API_KEY'",
          at("/events"),
        ]),
      )
      expect(stream.body).toBe("data: one\n\ndata: two\n\n")
      expect(seen.findLast((request) => request.path === "/events")?.authorization).toBe("Bearer sk_live_real")
    }),
  )

  it.live("a call to Ren's host reaches Ren with the brain's host token, which the brain never holds", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const reply = yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-H",
          "'Authorization: Bearer ren:REN'",
          at("/host/pull", "ren.test"),
        ]),
      )
      expect(reply.status).toBe(200)
      expect(reply.body).not.toContain("Bearer ey")
      const authorization = seen.findLast((request) => request.path === "/host/pull")?.authorization ?? ""
      const token = authorization.replace(/^Bearer /u, "")
      const claims = yield* BrainToken.verify([brainKey.publicKey], token)
      expect(Option.map(claims, (found) => [found.scope, found.brain])).toEqual(Option.some(["host", found.brainId]))
    }),
  )

  it.live("a Ren MCP call reaches Ren with the brain's host token and keeps the chat headers", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      yield* Effect.promise(() =>
        EgressHarness.curl([
          socks(found.login, found.password),
          "-X",
          "POST",
          "-H",
          "'Authorization: Bearer ren:REN'",
          "-H",
          `'${HostMcp.sessionHeader}: ses_chat'`,
          "-H",
          `'${HostMcp.userHeader}: usr_sender'`,
          at("/mcp", "ren.test"),
        ]),
      )
      const request = seen.findLast((each) => each.host.startsWith("ren.test") && each.path === "/mcp")
      expect(request?.chat).toEqual(["ses_chat", "usr_sender"])
      const claims = yield* BrainToken.verify(
        [brainKey.publicKey],
        request?.authorization?.replace(/^Bearer /u, "") ?? "",
      )
      expect(Option.map(claims, (each) => [each.scope, each.brain])).toEqual(Option.some(["host", found.brainId]))
    }),
  )

  it.live("after Ren revokes a login, its open connection is closed and a new one is refused", () =>
    Effect.gen(function* () {
      const found = yield* setup()
      const callers = yield* CredentialCallers.Service
      const control = yield* EgressControl.Service
      const held = EgressHarness.curl([socks(found.login, found.password), "-N", at("/hold")])
      yield* Effect.promise(async () => {
        // ast-grep-ignore: no-test-sleep -- the request comes from a curl process through the egress; the test sees it only when the upstream records it
        while (!seen.some((request) => request.path === "/hold")) await Bun.sleep(20)
      })
      const revoked = yield* callers.revoke({ kind: "brain", id: found.brainId })
      yield* Effect.forEach(revoked.logins, (login) => control.invalidate({ login }), { discard: true })
      const closed = yield* Effect.promise(() => held)
      expect(closed.stderr).not.toContain("timed out")
      const again = yield* Effect.promise(() =>
        EgressHarness.curl([socks(found.login, found.password), at("/v1/charges")]),
      )
      expect(again.status).toBe(0)
    }),
  )
})

// oxlint-disable-next-line ren/no-comments -- A brain and an executor of an org with the GitHub App, both behind the egress: the brain reads GitHub with a proxy on each request, the executor runs as its own process with HTTP_PROXY.
const behindEgress = Effect.fnUntraced(function* (github: TestGitHub.Instance) {
  const database = yield* Database.Service
  const found = yield* setup()
  const workspace = String(Math.floor(Math.random() * 1e9))
  githubApp.installations.set(workspace, "acme")
  yield* database.db.insert(Database.Schema.channel_install).values({
    id: ChannelInstall.ID.create(),
    organization_id: found.organizationId,
    provider: "github",
    workspace,
    name: "acme",
  })
  const proxy = `http://${found.login}:${found.password}@127.0.0.1:${state.egress?.tunnel ?? 0}`
  const port = new URL(github.hosts.git).port
  const hosts: GitHubReader.Hosts = {
    host: "github.com",
    git: `http://github.com:${port}/git`,
    api: `http://api.github.com:${port}/api`,
    raw: `http://raw.githubusercontent.com:${port}/raw`,
  }
  const reader = yield* GitHubReader.make(Effect.succeed(hosts)).pipe(Effect.provide(FetchHttpClient.layer))
  const proxied = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => fetch(input, { ...init, proxy }),
    { preconnect: fetch.preconnect },
  )
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-executor-"))))
  const environmentId = Environment.ID.create()
  const executorPort = EgressHarness.freePort()
  const executor = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(["bun", new URL("../../executor/src/main.ts", import.meta.url).pathname], {
        env: {
          ...process.env,
          PORT: String(executorPort),
          EXECUTOR_HOST: "127.0.0.1",
          EXECUTOR_ENVIRONMENT_ID: environmentId,
          EXECUTOR_WORKSPACE: directory,
          ENVIRONMENT_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)([TestEnvironment.keys.publicKey]),
          HTTP_PROXY: proxy,
        },
        stdout: "ignore",
        stderr: "pipe",
      }),
    ),
    (spawned) =>
      Effect.promise(() => {
        spawned.kill("SIGKILL")
        return spawned.exited
      }),
  )
  yield* Effect.promise(() => EgressHarness.waitForPort(executorPort, executor, () => "the executor did not start"))
  const sessionId = Session.ID.create()
  const access = yield* TestEnvironment.access({
    url: `http://127.0.0.1:${executorPort}`,
    environmentId,
    brain: Brain.ofSession(sessionId),
    directory: join(directory, sessionId),
  })
  const connections = Context.get(
    yield* Layer.build(
      EnvironmentConnections.layer.pipe(
        Layer.provide(TestAccess.fixed(new Map([[sessionId, access]]))),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    EnvironmentConnections.Service,
  )
  return {
    reader,
    viaEgress: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(FetchHttpClient.Fetch, proxied)),
    directory,
    files: EnvironmentSession.make(connections, sessionId, (signal) => new Error(signal)).files,
  }
})

describe("GitHub through the egress", () => {
  it.live("a private reference unpacks with the GitHub App installed, and the environment holds only ren:GITHUB", () =>
    Effect.gen(function* () {
      const github = yield* TestGitHub.make({ repo: "docs", isPrivate: true })
      const commit = yield* github.commit({ "guide.md": "Use the docs." })
      const brain = yield* behindEgress(github)
      const lookup = yield* brain.viaEgress(brain.reader.lookup("https://github.com/acme/docs"))
      expect(lookup).toMatchObject({ commit, access: "placeholder" })
      const archive = brain.reader.archive(lookup)
      expect(archive.headers).toEqual({ authorization: "Bearer ren:GITHUB" })
      const path = join(brain.directory, "references", commit.slice(0, 12))
      yield* brain.files.unpack({
        ...archive,
        folder: ".",
        path,
        maxBytes: EnvironmentApi.maxReferenceBytes,
        maxFiles: EnvironmentApi.maxReferenceFiles,
        links: "skip",
      })
      expect(yield* Effect.promise(() => Bun.file(join(path, "guide.md")).text())).toBe("Use the docs.")
      const sent = (yield* github.authorizations).flatMap((request) => (request[1] ? [request[1]] : []))
      expect(sent.length).toBeGreaterThan(0)
      expect(sent.filter((authorization) => authorization.includes("ren:GITHUB"))).toEqual([])
    }),
  )

  it.live("a skill from a private repository loads with the GitHub App installed", () =>
    Effect.gen(function* () {
      const github = yield* TestGitHub.make({ repo: "skills", isPrivate: true })
      const commit = yield* github.commit({
        "pdf/SKILL.md": "---\nname: PDF\ndescription: Fill PDF forms\n---\nRun fill.sh\n",
        "pdf/fill.sh": "echo fill\n",
      })
      const brain = yield* behindEgress(github)
      const skills = SkillSource.make(brain.reader)
      const resolved = yield* brain.viaEgress(skills.resolve({ url: "https://github.com/acme/skills", path: "pdf" }))
      expect(resolved.document).toContain("Run fill.sh")
      const path = join(brain.directory, "skills", commit.slice(0, 12))
      yield* brain.files.unpack({ ...skills.archive(resolved), folder: "pdf", path })
      expect(yield* Effect.promise(() => Bun.file(join(path, "fill.sh")).text())).toBe("echo fill\n")
      const sent = (yield* github.authorizations).flatMap((request) => (request[1] ? [request[1]] : []))
      expect(sent.filter((authorization) => authorization.includes("ren:GITHUB"))).toEqual([])
    }),
  )
})
