import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Mcp } from "@ren/schema/mcp"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { AppRelease } from "../src/app/release.js"
import { CredentialRefresh } from "../src/credential-refresh.js"
import { Credentials } from "../src/credentials.js"
import { DurableRunner } from "../src/durable-runner.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { OAuth } from "../src/oauth.js"
import { McpProvider } from "../src/mcp-provider.js"
import { OAuthApps } from "../src/oauth-apps.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { testEffect } from "./lib/effect.js"
import { OAuthServer } from "./lib/oauth-server.js"
import { Seed } from "./lib/seed.js"

const server = OAuthServer.start()
afterAll(() => server.stop())

const invalidated: Array<string> = []

const it = testEffect(
  Layer.mergeAll(OAuth.layer, CredentialRefresh.layer, App.layer, AppRelease.layer, OAuthApps.layer).pipe(
    Layer.provideMerge(OAuth.layerRefresher),
    Layer.provideMerge(Credentials.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        Access.layer,
        Envelope.layerLocal,
        OAuthFetch.layerUnchecked,
        DurableRunner.layerMemory,
        McpProvider.layerNone,
        Layer.succeed(
          EgressControl.Service,
          EgressControl.Service.of({
            invalidate: (selector) => Effect.sync(() => invalidated.push(selector.label ?? "")),
          }),
        ),
      ),
    ),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
          REN_URL: "https://ren.test",
        }),
      ),
    ),
  ),
)

const decodeSealed = Schema.decodeUnknownSync(Schema.fromJsonString(Credentials.Sealed))

const oauth = (
  auth: Omit<Extract<Mcp.Auth, { type: "oauth" }>, "type" | "tokenEndpointAuth"> = {},
  requiredCredentials: Mcp.Declaration["requiredCredentials"] = [],
): Mcp.Declaration => ({
  name: "Linear",
  description: "Linear issues",
  transport: { type: "remote", url: "https://mcp.example.test/mcp" },
  auth: { type: "oauth", tokenEndpointAuth: "none", ...auth },
  requiredCredentials,
})

const setup = Effect.fnUntraced(function* (declaration: Mcp.Declaration = oauth()) {
  const apps = yield* App.Service
  const database = yield* Database.Service
  const organizationId = yield* Seed.organization()
  const actor = yield* Seed.actor(organizationId, "admin")
  const space = yield* Seed.space(organizationId)
  const app = yield* apps.create(
    actor,
    Seed.appInput(space, `linear-${crypto.randomUUID().slice(0, 8)}`, { mcps: { linear: declaration } }),
  )
  yield* database.db
    .update(Database.Schema.app_release)
    .set({
      mcps: {
        linear: {
          name: declaration.name,
          description: declaration.description,
          auth: declaration.auth,
          requiredCredentials: declaration.requiredCredentials,
          transport: { type: "remote", url: server.mcpUrl },
        },
      },
    })
    .where(eq(Database.Schema.app_release.id, app.latestReleaseId))
  return { actor, app, space, declaration, owner: { kind: "person" as const, userId: actor.userId } }
})

const connect = Effect.fnUntraced(function* (
  found: Effect.Success<ReturnType<typeof setup>>,
  options: { readonly connection?: string; readonly reconnect?: boolean } = {},
) {
  const service = yield* OAuth.Service
  const result = yield* service.connect(found.actor, {
    owner: found.owner,
    target: {
      kind: "mcp",
      app: found.app.id,
      mcp: "linear",
      ...(options.connection && { connection: options.connection }),
    },
    ...(options.reconnect && { reconnect: true }),
  })
  if (!("redirectUrl" in result)) return yield* Effect.die(new Error("expected a redirect"))
  return new URL(result.redirectUrl)
})

const stored = Effect.fnUntraced(function* (label: string) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const row = (yield* database.db
    .select()
    .from(Database.Schema.credential)
    .where(eq(Database.Schema.credential.label, label))).at(-1)
  if (!row) return
  const opened = yield* envelope.open(row.value, {
    organizationId: row.organization_id,
    kind: "credential",
    id: row.id,
  })
  return { row, value: decodeSealed(Redacted.value(opened)) }
})

const reset = (options: OAuthServer.Options = {}) =>
  Effect.sync(() => {
    server.options = options
    server.seen.length = 0
    invalidated.length = 0
  })

describe("OAuth.connect: discovery (§7 rule 2, test 8)", () => {
  it.live("resource_metadata from WWW-Authenticate, then the server metadata; the authorize URL uses it", () =>
    Effect.gen(function* () {
      yield* reset({ challenge: { scope: "read" } })
      const redirect = yield* connect(yield* setup())
      expect(`${redirect.origin}${redirect.pathname}`).toBe(`${server.origin}/authorize`)
      expect(redirect.searchParams.get("code_challenge_method")).toBe("S256")
      expect(redirect.searchParams.get("resource")).toBe(server.mcpUrl)
      expect(redirect.searchParams.get("scope")).toBe("read")
      expect(redirect.searchParams.get("client_id")).toBe("registered-client")
      expect(server.seen.map((seen) => seen.path)).toContain("/.well-known/oauth-protected-resource/mcp")
    }),
  )

  it.live(
    "metadata below the root and the OpenID fallback are found; with no metadata the declared endpoints are used",
    () =>
      Effect.gen(function* () {
        yield* reset({
          challenge: { resourceMetadata: false },
          resourceMetadata: "root",
          issuerPath: "/auth",
          authorizationMetadata: "openid",
        })
        const found = yield* connect(yield* setup())
        expect(found.pathname).toBe("/authorize")
        expect(server.seen.map((seen) => seen.path)).toContain("/.well-known/openid-configuration/auth")
        yield* reset({ challenge: "none", resourceMetadata: "none", authorizationMetadata: "none" })
        const declared = yield* connect(
          yield* setup(
            oauth({
              authorizationEndpoint: "https://login.example.test/authorize",
              tokenEndpoint: "https://login.example.test/token",
              client: { clientId: "partner" },
            }),
          ),
        )
        expect(`${declared.origin}${declared.pathname}`).toBe("https://login.example.test/authorize")
      }),
  )

  it.live("a server that needs no sign-in is refused", () =>
    Effect.gen(function* () {
      yield* reset({ challenge: "open" })
      const service = yield* OAuth.Service
      const found = yield* setup()
      const error = yield* Effect.flip(
        service.connect(found.actor, { owner: found.owner, target: { kind: "mcp", app: found.app.id, mcp: "linear" } }),
      )
      expect(error.message).toContain("does not ask for sign-in")
    }),
  )
})

describe("OAuth.connect: client, scope, resource and PKCE (tests 9, 10, 11, 32)", () => {
  it.live("a borrowed client skips discovery; the metadata document comes before registration", () =>
    Effect.gen(function* () {
      yield* reset()
      const borrowed = yield* connect(
        yield* setup(
          oauth({
            authorizationEndpoint: "https://login.example.test/authorize",
            tokenEndpoint: "https://login.example.test/token",
            client: { clientId: "partner" },
          }),
        ),
      )
      expect(borrowed.searchParams.get("client_id")).toBe("partner")
      expect(server.seen).toEqual([])
      yield* reset({ metadata: { client_id_metadata_document_supported: true } })
      const document = yield* connect(yield* setup())
      expect(document.searchParams.get("client_id")).toBe("https://ren.test/oauth/client.json")
      expect(server.seen.map((seen) => seen.path)).not.toContain("/register")
    }),
  )

  it.live(
    "scopes come from the challenge, else the resource metadata, else the declaration; offline_access only when listed",
    () =>
      Effect.gen(function* () {
        yield* reset({ challenge: {}, resourceScopes: ["issues:read"] })
        expect((yield* connect(yield* setup(oauth({ scopes: ["declared"] })))).searchParams.get("scope")).toBe(
          "issues:read",
        )
        yield* reset({ challenge: {}, metadata: { scopes_supported: ["read", "offline_access"] } })
        expect((yield* connect(yield* setup(oauth({ scopes: ["declared"] })))).searchParams.get("scope")).toBe(
          "declared offline_access",
        )
      }),
  )

  it.live("PKCE methods without S256 refuse the connect; a missing list is accepted", () =>
    Effect.gen(function* () {
      yield* reset({ metadata: { code_challenge_methods_supported: ["plain"] } })
      const service = yield* OAuth.Service
      const found = yield* setup()
      const error = yield* Effect.flip(
        service.connect(found.actor, { owner: found.owner, target: { kind: "mcp", app: found.app.id, mcp: "linear" } }),
      )
      expect(error.message).toContain("S256")
      yield* reset({ metadata: { code_challenge_methods_supported: undefined } })
      expect((yield* connect(yield* setup())).searchParams.get("code_challenge")).toBeTruthy()
    }),
  )
})

describe("OAuth.connect: org apps (test 9, owner-access §7)", () => {
  it.live(
    "an org app comes first and a static one skips discovery; a missing one is AppNotConfigured; archive needs force while in use",
    () =>
      Effect.gen(function* () {
        yield* reset()
        const service = yield* OAuth.Service
        const apps = yield* OAuthApps.Service
        const declaration = oauth({}, [{ kind: "oauth_app", name: "Linear", optional: false }])
        const found = yield* setup(declaration)
        const missing = yield* Effect.flip(
          service.connect(found.actor, {
            owner: found.owner,
            target: { kind: "mcp", app: found.app.id, mcp: "linear" },
          }),
        )
        expect(missing.message).toContain("AppNotConfigured")
        const app = yield* apps.create(found.actor, {
          name: "Linear",
          clientId: "org-client",
          clientSecret: Redacted.make("org-secret"),
          discovery: "static",
          authorizationEndpoint: `https://login.example.test/authorize`,
          tokenEndpoint: `https://login.example.test/token`,
          authorizeParams: { prompt: "consent" },
        })
        expect(app).toMatchObject({ hasClientSecret: true, tokenEndpointAuth: "client_secret_post" })
        expect(JSON.stringify(app)).not.toContain("org-secret")
        const redirect = yield* connect(found)
        expect(redirect.searchParams.get("client_id")).toBe("org-client")
        expect(redirect.searchParams.get("prompt")).toBe("consent")
        expect(server.seen).toEqual([])
        const database = yield* Database.Service
        yield* database.db
          .update(Database.Schema.oauth_app)
          .set({ token_endpoint: `${server.origin}/token` })
          .where(eq(Database.Schema.oauth_app.id, app.id))
        const second = yield* connect(found, { connection: "two" })
        yield* service.callback({ state: second.searchParams.get("state") ?? "", code: "c" }, Option.none())
        expect(server.seen.find((seen) => seen.path === "/token")?.form.get("client_secret")).toBe("org-secret")
        expect((yield* Effect.flip(apps.archive(found.actor, app.id))).message).toContain("InUse")
        yield* apps.archive(found.actor, app.id, { force: true })
        expect(yield* stored("MCP_LINEAR__TWO")).toBeUndefined()
      }),
  )
})

describe("OAuth.callback (tests 12, 13, 27, 29, 32)", () => {
  it.live(
    "a sign-in saves an oauth credential with app, mcp and resource; the token request sends the verifier and resource",
    () =>
      Effect.gen(function* () {
        yield* reset()
        const service = yield* OAuth.Service
        const found = yield* setup()
        const redirect = yield* connect(found)
        const state = redirect.searchParams.get("state") ?? ""
        const outcome = yield* service.callback({ state, code: "c1" }, Option.none())
        expect(outcome).toMatchObject({ ok: true, label: "MCP_LINEAR" })
        const saved = yield* stored("MCP_LINEAR")
        expect(saved?.row).toMatchObject({
          type: "oauth",
          app_id: found.app.id,
          mcp: "linear",
          connection: null,
          account_user_id: found.actor.userId,
          hosts: ["127.0.0.1"],
        })
        expect(saved?.row.expires_at).not.toBeNull()
        expect(saved?.value.type === "oauth" && saved.value.refresh?.resource).toBe(server.mcpUrl)
        const token = server.seen.find((seen) => seen.path === "/token")
        expect(token?.form.get("code_verifier")).toBeTruthy()
        expect(token?.form.get("resource")).toBe(server.mcpUrl)
        expect(invalidated).toEqual(["MCP_LINEAR"])
        expect(yield* service.callback({ state, code: "c1" }, Option.none())).toEqual({
          ok: false,
          reason: "StateInvalid: used",
        })
      }),
  )

  it.live("the callback uses the release recorded at start, also after a newer release (test 27)", () =>
    Effect.gen(function* () {
      yield* reset()
      const service = yield* OAuth.Service
      const releases = yield* AppRelease.Service
      const found = yield* setup()
      const redirect = yield* connect(found)
      yield* releases.create(found.actor, {
        requiredCredentials: [],
        skills: {},
        dependsOn: [],
        appId: found.app.id,
        expectedLatestReleaseId: found.app.latestReleaseId,
        version: "0.0.2",
        mcps: {
          linear: {
            name: "Linear",
            description: "Linear issues",
            auth: found.declaration.auth,
            requiredCredentials: [],
            transport: { type: "remote", url: "https://linear-v2.example.test/mcp" },
          },
        },
      })
      yield* service.callback({ state: redirect.searchParams.get("state") ?? "", code: "c" }, Option.none())
      expect((yield* stored("MCP_LINEAR"))?.row.hosts).toEqual(["127.0.0.1"])
    }),
  )

  it.live("token answers: no refresh token and expires_in as a string are accepted; a 2xx error and DPoP fail", () =>
    Effect.gen(function* () {
      const service = yield* OAuth.Service
      const answers = [
        { body: { access_token: "a", token_type: "bearer", expires_in: "3600" }, ok: true },
        { body: { access_token: "b" }, ok: true },
        { body: { error: "invalid_request" }, ok: false },
        { body: { access_token: "c", token_type: "DPoP" }, ok: false },
      ]
      const outcomes = yield* Effect.forEach(answers, (answer) =>
        Effect.gen(function* () {
          yield* reset({ token: () => ({ status: 200, body: answer.body }) })
          const redirect = yield* connect(yield* setup())
          return (yield* service.callback(
            { state: redirect.searchParams.get("state") ?? "", code: "c" },
            Option.none(),
          )).ok
        }),
      )
      expect(outcomes).toEqual(answers.map((answer) => answer.ok))
      const last = yield* stored("MCP_LINEAR")
      expect(last?.row.expires_at).toBeNull()
    }),
  )

  it.live(
    "iss: compared when present, required when the server says it sends it, skipped otherwise; a mismatch shows no provider text",
    () =>
      Effect.gen(function* () {
        const service = yield* OAuth.Service
        const run = (supported: boolean, iss: string | undefined, extra: Partial<OAuth.Callback> = {}) =>
          Effect.gen(function* () {
            yield* reset({ metadata: { authorization_response_iss_parameter_supported: supported } })
            const redirect = yield* connect(yield* setup())
            return yield* service.callback(
              {
                state: redirect.searchParams.get("state") ?? "",
                code: "c",
                ...(iss !== undefined && { iss }),
                ...extra,
              },
              Option.none(),
            )
          })
        expect((yield* run(true, server.issuer)).ok).toBe(true)
        expect((yield* run(true, undefined)).ok).toBe(false)
        expect((yield* run(false, `${server.issuer}/`)).ok).toBe(false)
        expect((yield* run(false, undefined)).ok).toBe(true)
        const mismatch = yield* run(true, "https://evil.test", {
          error: "access_denied",
          errorDescription: "Click evil.test",
        })
        expect(mismatch.ok).toBe(false)
        expect(JSON.stringify(mismatch)).not.toContain("evil.test")
        const denied = yield* run(false, undefined, { error: "access_denied", errorDescription: "The person said no" })
        expect(denied).toEqual({ ok: false, reason: "The person said no" })
      }),
  )

  it.live(
    "a reconnect keeps the old value until the save, then raises the revision and asks for granted plus wanted scopes",
    () =>
      Effect.gen(function* () {
        yield* reset({ token: () => OAuthServer.bearer("tok_first", { scope: "read" }) })
        const service = yield* OAuth.Service
        const credentials = yield* Credentials.Service
        const found = yield* setup()
        const first = yield* connect(found)
        yield* service.callback({ state: first.searchParams.get("state") ?? "", code: "c" }, Option.none())
        const before = yield* stored("MCP_LINEAR")
        if (!before) return yield* Effect.die(new Error("expected a credential"))
        yield* credentials.addWantedScopes(before.row.id, ["write"])
        const again = yield* connect(found, { reconnect: true })
        expect(again.searchParams.get("scope")?.split(" ").toSorted()).toEqual(["read", "write"])
        const during = yield* stored("MCP_LINEAR")
        expect(during?.value.type === "oauth" && Redacted.value(during.value.accessToken)).toBe("tok_first")
        server.options = { token: () => OAuthServer.bearer("tok_second", { scope: "read write" }) }
        yield* service.callback({ state: again.searchParams.get("state") ?? "", code: "c" }, Option.none())
        const after = yield* stored("MCP_LINEAR")
        expect(after?.row).toMatchObject({
          id: before.row.id,
          revision: 2,
          wanted_scopes: [],
          scopes: ["read", "write"],
        })
        expect(after?.value.type === "oauth" && Redacted.value(after.value.accessToken)).toBe("tok_second")
      }),
  )

  it.live("a second connection with the same sub warns; another sub does not; the hash, not the id, is stored", () =>
    Effect.gen(function* () {
      const service = yield* OAuth.Service
      const idToken = (sub: string) => `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`
      yield* reset({ token: () => OAuthServer.bearer("t", { id_token: idToken("user-1") }) })
      const found = yield* setup()
      const first = yield* connect(found)
      yield* service.callback({ state: first.searchParams.get("state") ?? "", code: "c" }, Option.none())
      const second = yield* connect(found, { connection: "acme" })
      const same = yield* service.callback({ state: second.searchParams.get("state") ?? "", code: "c" }, Option.none())
      expect(same).toMatchObject({ ok: true, label: "MCP_LINEAR__ACME", sameAccountAs: Option.some("Linear") })
      server.options = { token: () => OAuthServer.bearer("t", { id_token: idToken("user-2") }) }
      const third = yield* connect(found, { connection: "globex" })
      const other = yield* service.callback({ state: third.searchParams.get("state") ?? "", code: "c" }, Option.none())
      expect(other).toMatchObject({ ok: true, sameAccountAs: Option.none() })
      const row = (yield* stored("MCP_LINEAR__ACME"))?.row
      expect(row?.account_subject_hash).toBe(new Bun.CryptoHasher("sha256").update("user-1").digest("hex"))
      expect(row?.connection).toBe("acme")
    }),
  )
})

describe("OAuth refresher (§8; tests 3, 5, 6, 7, 10)", () => {
  const signedIn = Effect.fnUntraced(function* (token: () => { status: number; body: unknown }) {
    yield* reset({ token })
    const service = yield* OAuth.Service
    const database = yield* Database.Service
    const redirect = yield* connect(yield* setup())
    yield* service.callback({ state: redirect.searchParams.get("state") ?? "", code: "c" }, Option.none())
    const saved = yield* stored("MCP_LINEAR")
    if (!saved) return yield* Effect.die(new Error("expected a credential"))
    yield* database.db
      .update(Database.Schema.credential)
      .set({ expires_at: new Date(Date.now() + 60_000) })
      .where(eq(Database.Schema.credential.id, saved.row.id))
    server.seen.length = 0
    return saved.row.id
  })

  it.live("a refresh sends the same resource; an answer without refresh_token or scope keeps the old ones", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      const id = yield* signedIn(() =>
        OAuthServer.bearer("tok_1", { refresh_token: "ref_1", scope: "read", expires_in: 3600 }),
      )
      server.options = { token: () => OAuthServer.bearer("tok_2", { expires_in: 3600 }) }
      yield* refresh.refresh(id, {})
      const request = server.seen.find((seen) => seen.path === "/token")
      expect(request?.form.get("grant_type")).toBe("refresh_token")
      expect(request?.form.get("resource")).toBe(server.mcpUrl)
      expect(request?.form.get("client_id")).toBe("registered-client")
      const saved = yield* stored("MCP_LINEAR")
      expect(saved?.row).toMatchObject({ revision: 2, scopes: ["read"] })
      expect(
        saved?.value.type === "oauth" && saved.value.refresh && Redacted.value(saved.value.refresh.refreshToken),
      ).toBe("ref_1")
    }),
  )

  it.live("400 invalid_grant is fatal; 503 with invalid_grant and an object error are temporary", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      const answers: ReadonlyArray<{
        readonly status: number
        readonly body: unknown
        readonly after: "ok" | "reconnect"
      }> = [
        { status: 503, body: { error: "invalid_grant" }, after: "ok" },
        { status: 400, body: { error: { code: "x" } }, after: "ok" },
        { status: 400, body: { error: "invalid_grant" }, after: "reconnect" },
      ]
      const statuses = yield* Effect.forEach(answers, (answer) =>
        Effect.gen(function* () {
          const id = yield* signedIn(() => OAuthServer.bearer("tok_1", { refresh_token: "ref_1", expires_in: 3600 }))
          server.options = { token: () => ({ status: answer.status, body: answer.body }) }
          yield* refresh.refresh(id, {})
          return (yield* stored("MCP_LINEAR"))?.row.status
        }),
      )
      expect(statuses).toEqual(answers.map((answer) => answer.after))
    }),
  )

  it.live("a token with an expiry and no refresh token needs a reconnect only at its expiry", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      const database = yield* Database.Service
      const id = yield* signedIn(() => OAuthServer.bearer("tok_1", { expires_in: 3600 }))
      yield* refresh.refresh(id, {})
      expect((yield* stored("MCP_LINEAR"))?.row).toMatchObject({ status: "ok", revision: 1 })
      yield* database.db
        .update(Database.Schema.credential)
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where(eq(Database.Schema.credential.id, id))
      yield* refresh.refresh(id, {})
      expect((yield* stored("MCP_LINEAR"))?.row.status).toBe("reconnect")
    }),
  )

  it.live("the server's metadata names another issuer: no token request, status reconnect", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      const id = yield* signedIn(() => OAuthServer.bearer("tok_1", { refresh_token: "ref_1", expires_in: 3600 }))
      server.options = { metadata: { issuer: "https://other.test" } }
      yield* refresh.refresh(id, {})
      expect(server.seen.map((seen) => seen.path)).not.toContain("/token")
      expect((yield* stored("MCP_LINEAR"))?.row.status).toBe("reconnect")
    }),
  )
})
