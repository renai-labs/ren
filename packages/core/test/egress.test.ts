import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { BrainToken } from "@ren/host-api/brain-token"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Credential } from "@ren/schema/credential"
import { Injection } from "@ren/schema/injection"
import { Signature } from "@ren/schema/signature"
import { eq } from "drizzle-orm"
import { ConfigProvider, DateTime, Effect, Layer, Logger, Option, Redacted, Ref, References, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { BrainClient } from "../src/brain-client.js"
import { CredentialCallers } from "../src/credential-callers.js"
import { CredentialRefresh } from "../src/credential-refresh.js"
import { CredentialSource } from "../src/credential-source.js"
import { Credentials } from "../src/credentials.js"
import { DurableRunner } from "../src/durable-runner.js"
import { Egress } from "../src/egress.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { McpProvider } from "../src/mcp-provider.js"
import { Models } from "../src/models.js"
import { Signer } from "../src/signer.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { ProfilesFixture } from "./lib/profiles.js"
import { Seed } from "./lib/seed.js"

const invalidations: Array<unknown> = []
const egress = Bun.serve({
  port: 0,
  fetch: async (request) => {
    invalidations.push(await request.json())
    return new Response(null, { status: 204 })
  },
})
afterAll(() => egress.stop(true))

const brainKey = await Effect.runPromise(Signature.generate("brain"))

const refreshed = Ref.makeUnsafe<ReadonlyArray<Credential.ID>>([])

const refreshers = Layer.succeed(
  CredentialRefresh.Refreshers,
  new Map([
    [
      "oauth" as const,
      {
        refresh: (current: CredentialRefresh.Current) =>
          Ref.update(refreshed, (all) => [...all, current.id]).pipe(
            Effect.as(
              Option.some({
                value: { type: "oauth" as const, accessToken: Redacted.make("renewed") },
                expiresAt: Option.none(),
              }),
            ),
          ),
      },
    ],
  ]),
)

const expiresAt = DateTime.makeUnsafe("2030-01-01T00:00:00Z")

// oxlint-disable-next-line ren/no-comments -- A provider whose route carries a short-lived Bearer token, as Pipedream's does (§14 rule 3).
const timed = Effect.succeed(
  Option.some<McpProvider.Provider>({
    id: "timed",
    connect: () => Effect.succeed({ redirectUrl: "https://timed.test", account: "a" }),
    status: () => Effect.succeed("active"),
    open: () => Effect.succeed({}),
    route: () =>
      Effect.succeed({
        upstream: Redacted.make("https://remote.timed.test/v3"),
        headers: [{ name: "authorization", value: Redacted.make("Bearer short") }],
        expiresAt,
      }),
    renew: (state) => Effect.succeed(state),
    remove: () => Effect.void,
  }),
)

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    revision: Effect.succeed("test"),
    grant: () =>
      Effect.succeed(
        Models.Access.make({
          endpoints: [
            {
              id: "gateway",
              protocol: "openai-chat",
              baseUrl: "https://models.ren.test/v1",
              apiKey: { key: Redacted.make("sk-model") },
              models: [],
            },
          ],
        }),
      ),
    inference: Effect.succeedNone,
  }),
)

const audits: Array<{ readonly message: string; readonly annotations: Readonly<Record<string, unknown>> }> = []

const audited = Logger.layer(
  [
    Logger.make((options) => {
      audits.push({
        message: String(options.message),
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      })
    }),
  ],
  { mergeWithExisting: true },
)

const it = testEffect(
  Layer.mergeAll(Egress.layer, Space.layer, SpaceMember.layer, SpaceProvisioning.layer, App.layer).pipe(
    Layer.provideMerge(AppProfiles.layer),
    Layer.provideMerge(CredentialRefresh.layer),
    Layer.provideMerge(Layer.mergeAll(refreshers, DurableRunner.layerMemory)),
    Layer.provideMerge(CredentialSource.layer),
    Layer.provideMerge(
      Layer.mergeAll(CredentialSource.layerStatic, CredentialSource.layerMinted, CredentialSource.layerProvider),
    ),
    Layer.provideMerge(Layer.mergeAll(Credentials.layer, CredentialCallers.layer, BrainClient.layer, models)),
    Layer.provideMerge(
      Layer.mergeAll(
        Access.layer,
        Envelope.layerLocal,
        EgressControl.layerHttp,
        Signer.layerLocal,
        OAuthFetch.layerUnchecked,
        McpProvider.layer([McpProvider.composio, timed]),
      ),
    ),
    Layer.provideMerge(Testing.layer),
    Layer.provideMerge(audited),
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
          EGRESS_CONTROL_URLS: `http://127.0.0.1:${egress.port}`,
          REN_URL: "https://api.ren.test",
          COMPOSIO_API_KEY: "composio-project-key",
        }),
      ),
    ),
  ),
)

const everyOp = Injection.opNames

const all: Egress.Principal = { kind: "ren", orgs: "all" }

const setup = Effect.fnUntraced(function* () {
  const callers = yield* CredentialCallers.Service
  const spaces = yield* Space.Service
  const provisioning = yield* SpaceProvisioning.Service
  const organizationId = yield* Seed.organization()
  const seeded = yield* Seed.user()
  const memberId = yield* Seed.member(organizationId, seeded.id, "member")
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  const ada = { userId: seeded.id, organizationId, roles: ["member"] }
  const space = yield* spaces.create(ada, { name: "Team" })
  const brainId = Brain.ID.create()
  yield* Seed.session({ organizationId, spaceId: space.id, createdBy: ada.userId, brainId })
  const placement = yield* callers.issue(
    { workload: { kind: "brain", id: brainId, generation: 1 }, organizationId },
    "ProxyLogin",
  )
  if (placement.kind !== "ProxyLogin") return yield* Effect.die(new Error("expected a proxy login"))
  const proof: CredentialCallers.Proof = {
    kind: "ProxyLogin",
    username: placement.username,
    password: placement.password,
  }
  return { organizationId, ada, memberId, space, brainId, proof, login: placement.username }
})

const encodeSealed = Schema.encodeSync(Schema.fromJsonString(Credentials.Sealed))

const signIn = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  options: { readonly label?: string; readonly status?: Credential.Status } = {},
) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const id = Credential.ID.create()
  const value = yield* envelope.seal(
    Redacted.make(encodeSealed({ type: "oauth", accessToken: Redacted.make("tok") })),
    {
      organizationId,
      kind: "credential",
      id,
    },
  )
  yield* database.db.insert(Database.Schema.credential).values({
    id,
    organization_id: organizationId,
    owner: "org",
    label: options.label ?? "MCP_LINEAR",
    type: "oauth",
    value,
    hosts: ["mcp.linear.app"],
    inject: { op: "setHeader", name: "Authorization", format: "Bearer {value}" },
    status: options.status ?? "ok",
    scopes: ["read"],
  })
  return id
})

const row = Effect.fnUntraced(function* (id: Credential.ID) {
  const database = yield* Database.Service
  return (yield* database.db.select().from(Database.Schema.credential).where(eq(Database.Schema.credential.id, id))).at(
    0,
  )
})

const request = (
  proof: CredentialCallers.Proof,
  host: string,
  placeholders: ReadonlyArray<string>,
  ops: ReadonlyArray<Injection.OpName> = everyOp,
) => ({ proof, host, port: 443, method: "POST", path: "/v1/charges", placeholders, ops })

const values = (reply: Injection.Reply) =>
  reply.allow
    ? reply.inject.map((op) =>
        op.op === "route"
          ? { op: op.op, upstream: Redacted.value(op.upstream) }
          : { ...op, value: Redacted.value(op.value) },
      )
    : reply

describe("Egress.resolve", () => {
  it.live("a brain's placeholder becomes its space's key, for the key's host only", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const credentials = yield* Credentials.Service
      const found = yield* setup()
      yield* credentials.create(found.ada, {
        owner: { kind: "space", spaceId: found.space.id },
        label: "STRIPE_API_KEY",
        hosts: ["api.stripe.com"],
        value: { type: "key", value: Redacted.make("sk_live_real") },
      })
      const reply = yield* resolver.resolve(all, request(found.proof, "api.stripe.com", ["ren:STRIPE_API_KEY"]))
      expect(reply).toMatchObject({ allow: true, workload: `brain:${found.brainId}:1`, ttl: 30 })
      expect(values(reply)).toEqual([
        { op: "replace", placeholder: "ren:STRIPE_API_KEY", value: "sk_live_real", in: ["header"] },
      ])
      expect(yield* resolver.resolve(all, request(found.proof, "evil.example.com", ["ren:STRIPE_API_KEY"]))).toEqual({
        allow: false,
        reason: "host_not_allowed",
        label: "STRIPE_API_KEY",
      })
    }),
  )

  it.live("a principal limited to one org gets principal_scope for a workload of another org", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const found = yield* setup()
      const otherOrg: Auth.OrganizationID = yield* Seed.organization()
      expect(
        yield* resolver.resolve({ kind: "registered", orgs: [otherOrg] }, request(found.proof, "api.stripe.com", [])),
      ).toEqual({
        allow: false,
        reason: "principal_scope",
      })
      expect(
        yield* resolver.resolve(
          { kind: "registered", orgs: [found.organizationId] },
          request(found.proof, "api.stripe.com", []),
        ),
      ).toMatchObject({
        allow: true,
      })
    }),
  )

  it.live("a value with CR or LF never goes into a header; a basic credential becomes Basic base64(user:pass)", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const credentials = yield* Credentials.Service
      const found = yield* setup()
      yield* credentials.create(found.ada, {
        owner: { kind: "org" },
        label: "BROKEN",
        hosts: ["api.broken.dev"],
        value: { type: "key", value: Redacted.make("line\r\nX-Injected: 1") },
      })
      expect(yield* resolver.resolve(all, request(found.proof, "api.broken.dev", ["ren:BROKEN"]))).toEqual({
        allow: false,
        reason: "credential_missing",
        label: "BROKEN",
      })
      yield* credentials.create(found.ada, {
        owner: { kind: "org" },
        label: "JIRA",
        hosts: ["acme.atlassian.net"],
        value: { type: "basic", username: "ada@acme.dev", password: Redacted.make('p&ss/"') },
      })
      expect(values(yield* resolver.resolve(all, request(found.proof, "acme.atlassian.net", [])))).toEqual([
        {
          op: "setHeader",
          name: "Authorization",
          value: `Basic ${Buffer.from('ada@acme.dev:p&ss/"').toString("base64")}`,
        },
      ])
    }),
  )

  it.live("a missing label is named and works on the next request once saved; a delete clears every egress copy", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const credentials = yield* Credentials.Service
      const found = yield* setup()
      expect(yield* resolver.resolve(all, request(found.proof, "api.linear.app", ["ren:LINEAR_API_KEY"]))).toEqual({
        allow: false,
        reason: "credential_missing",
        label: "LINEAR_API_KEY",
      })
      const saved = yield* credentials.create(found.ada, {
        owner: { kind: "space", spaceId: found.space.id },
        label: "LINEAR_API_KEY",
        hosts: ["api.linear.app"],
        value: { type: "key", value: Redacted.make("lin_api_1") },
      })
      expect(
        yield* resolver.resolve(all, request(found.proof, "api.linear.app", ["ren:LINEAR_API_KEY"])),
      ).toMatchObject({
        allow: true,
      })
      invalidations.length = 0
      yield* credentials.remove(found.ada, saved.id, {})
      expect(invalidations).toEqual([{ label: "LINEAR_API_KEY" }])
      expect(yield* resolver.resolve(all, request(found.proof, "api.linear.app", ["ren:LINEAR_API_KEY"]))).toEqual({
        allow: false,
        reason: "credential_missing",
        label: "LINEAR_API_KEY",
      })
    }),
  )

  it.live(
    "an egress that does not report setHeader gets egress_outdated for such a credential, and replace still works",
    () =>
      Effect.gen(function* () {
        const resolver = yield* Egress.Service
        const credentials = yield* Credentials.Service
        const found = yield* setup()
        const old: ReadonlyArray<Injection.OpName> = ["replace"]
        yield* credentials.create(found.ada, {
          owner: { kind: "org" },
          label: "JIRA",
          hosts: ["acme.atlassian.net"],
          value: { type: "basic", username: "ada@acme.dev", password: Redacted.make("pass") },
        })
        expect(yield* resolver.resolve(all, request(found.proof, "acme.atlassian.net", [], old))).toEqual({
          allow: false,
          reason: "egress_outdated",
          label: "JIRA",
        })
        yield* credentials.create(found.ada, {
          owner: { kind: "org" },
          label: "STRIPE_API_KEY",
          hosts: ["api.stripe.com"],
          value: { type: "key", value: Redacted.make("sk_live_real") },
        })
        expect(
          yield* resolver.resolve(all, request(found.proof, "api.stripe.com", ["ren:STRIPE_API_KEY"], old)),
        ).toMatchObject({ allow: true })
      }),
  )

  it.live("a call to Ren's host gets the host token, with its expiry, so the egress never sends it after", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const found = yield* setup()
      const reply = yield* resolver.resolve(all, request(found.proof, "api.ren.test", ["ren:REN"]))
      if (!reply.allow) return yield* Effect.die(new Error("expected an allow"))
      expect(reply.labels).toEqual(["REN"])
      expect(reply.expiresAt).toBeGreaterThan(Date.now() / 1000 + BrainToken.lifetimes.host - 60)
      expect(reply.expiresAt).toBeLessThanOrEqual(Date.now() / 1000 + BrainToken.lifetimes.host)
    }),
  )

  it.live("an unknown login is unknown_workload", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      expect(
        yield* resolver.resolve(
          all,
          request({ kind: "ProxyLogin", username: "nobody", password: Redacted.make("x") }, "api.stripe.com", []),
        ),
      ).toEqual({ allow: false, reason: "unknown_workload" })
    }),
  )

  it.live(
    "the allow reply lists sign-in labels as refreshable with their revision and no key; reconnect is denied",
    () =>
      Effect.gen(function* () {
        const resolver = yield* Egress.Service
        const credentials = yield* Credentials.Service
        const found = yield* setup()
        yield* signIn(found.organizationId)
        yield* credentials.create(found.ada, {
          owner: { kind: "org" },
          label: "LINEAR_API_KEY",
          hosts: ["mcp.linear.app"],
          value: { type: "key", value: Redacted.make("lin_1") },
        })
        const reply = yield* resolver.resolve(
          all,
          request(found.proof, "mcp.linear.app", ["ren:MCP_LINEAR", "ren:LINEAR_API_KEY"]),
        )
        if (!reply.allow) return yield* Effect.die(new Error("expected an allow"))
        expect(reply.refreshable).toEqual([{ label: "MCP_LINEAR", revision: 1 }])
        yield* signIn(found.organizationId, { label: "MCP_GMAIL", status: "reconnect" })
        expect(yield* resolver.resolve(all, request(found.proof, "mcp.linear.app", ["ren:MCP_GMAIL"]))).toEqual({
          allow: false,
          reason: "credential_reconnect",
          label: "MCP_GMAIL",
        })
      }),
  )
})

describe("Egress.unauthorized", () => {
  it.live(
    "an older revision only clears caches; the same one refreshes once; a second report within 5 minutes does nothing; the status stays",
    () =>
      Effect.gen(function* () {
        const resolver = yield* Egress.Service
        const found = yield* setup()
        const id = yield* signIn(found.organizationId)
        yield* Ref.set(refreshed, [])
        invalidations.length = 0
        const report = (revision: number) => ({
          login: found.login,
          host: "mcp.linear.app",
          status: 401 as const,
          labels: [{ label: "MCP_LINEAR", revision }],
        })
        yield* resolver.unauthorized(all, report(0))
        expect(yield* Ref.get(refreshed)).toEqual([])
        expect(invalidations).toEqual([{ label: "MCP_LINEAR" }])
        yield* resolver.unauthorized(all, report(1))
        expect(yield* Ref.get(refreshed)).toEqual([id])
        expect((yield* row(id))?.revision).toBe(2)
        yield* resolver.unauthorized(all, report(2))
        expect(yield* Ref.get(refreshed)).toEqual([id])
        expect((yield* row(id))?.status).toBe("ok")
      }),
  )

  it.live("a report from a retired login is ignored", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const callers = yield* CredentialCallers.Service
      const found = yield* setup()
      yield* signIn(found.organizationId)
      yield* Ref.set(refreshed, [])
      yield* callers.revoke({ kind: "brain", id: found.brainId })
      invalidations.length = 0
      yield* resolver.unauthorized(all, {
        login: found.login,
        host: "mcp.linear.app",
        status: 401,
        labels: [{ label: "MCP_LINEAR", revision: 1 }],
      })
      expect(yield* Ref.get(refreshed)).toEqual([])
      expect(invalidations).toEqual([])
    }),
  )

  it.live("a report on REN or MODELS clears caches only", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const found = yield* setup()
      const first = yield* resolver.resolve(all, request(found.proof, "api.ren.test", ["ren:REN"]))
      if (!first.allow) return yield* Effect.die(new Error("expected an allow"))
      expect(first.refreshable).toEqual([{ label: "REN", revision: 0 }])
      yield* Ref.set(refreshed, [])
      invalidations.length = 0
      yield* resolver.unauthorized(all, {
        login: found.login,
        host: "api.ren.test",
        status: 401,
        labels: [{ label: "REN", revision: 0 }],
      })
      expect(yield* Ref.get(refreshed)).toEqual([])
      expect(invalidations).toEqual([{ label: "REN" }])
    }),
  )

  it.live("a 403 insufficient_scope adds the challenged scopes to wanted_scopes and changes nothing else (K47)", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const found = yield* setup()
      const id = yield* signIn(found.organizationId)
      yield* Ref.set(refreshed, [])
      const report = {
        login: found.login,
        host: "mcp.linear.app",
        status: 403 as const,
        scope: "read write admin",
        labels: [{ label: "MCP_LINEAR", revision: 1 }],
      }
      yield* resolver.unauthorized(all, report)
      yield* resolver.unauthorized(all, { ...report, scope: "write issues" })
      const saved = yield* row(id)
      expect(saved).toMatchObject({ status: "ok", revision: 1, scopes: ["read"] })
      expect(saved?.wanted_scopes.toSorted()).toEqual(["admin", "issues", "write"])
      expect(yield* Ref.get(refreshed)).toEqual([])
    }),
  )

  it.live("a Composio credential routes by its path placeholder to the session URL and sets x-api-key (test 24)", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const database = yield* Database.Service
      const envelope = yield* Envelope.Service
      const found = yield* setup()
      const id = Credential.ID.create()
      const value = yield* envelope.seal(
        Redacted.make(
          encodeSealed({
            type: "route",
            state: {
              sessionId: "trs_secret",
              url: "https://backend.composio.dev/tool_router/trs_secret/mcp",
              user: id,
              integration: "gmail",
              account: "ca_1",
            },
          }),
        ),
        { organizationId: found.organizationId, kind: "credential", id },
      )
      yield* database.db.insert(Database.Schema.credential).values({
        id,
        organization_id: found.organizationId,
        owner: "org",
        label: "MCP_GMAIL",
        type: "route",
        provider: "composio",
        provider_account_id: "ca_1",
        value,
        hosts: ["backend.composio.dev"],
        inject: { op: "route" },
      })
      const reply = yield* resolver.resolve(all, request(found.proof, "backend.composio.dev", ["ren:MCP_GMAIL"]))
      if (!reply.allow) return yield* Effect.die(new Error("expected an allow"))
      expect(values(reply)).toEqual([
        { op: "route", upstream: "https://backend.composio.dev/tool_router/trs_secret/mcp" },
        { op: "setHeader", name: "x-api-key", value: "composio-project-key" },
      ])
      expect(reply.inject.at(0)).toMatchObject({ placeholder: "ren:MCP_GMAIL" })
      expect(reply.refreshable).toEqual([{ label: "MCP_GMAIL", revision: 1 }])
      expect(yield* resolver.resolve(all, request(found.proof, "backend.composio.dev", []))).toMatchObject({
        allow: true,
        inject: [],
      })
    }),
  )

  it.live(
    "candidates hold loose keys and only the reached profiles' current items; an unused credential is denied",
    () =>
      Effect.gen(function* () {
        const resolver = yield* Egress.Service
        const apps = yield* App.Service
        const found = yield* setup()
        const app = yield* ProfilesFixture.app(found.ada, found.space.id, "mail", {
          mcps: { gmail: ProfilesFixture.remote("Gmail"), drive: ProfilesFixture.remote("Drive") },
        })
        const profiles = yield* AppProfiles.Service
        const team = (yield* profiles.list(found.ada, { appId: app.id, page: 1, pageSize: 50 })).items.at(0)
        if (!team) return yield* Effect.die(new Error("expected the owner-space profile"))
        const other = yield* ProfilesFixture.profile(found.ada, {
          appId: app.id,
          slug: "other",
          kind: "shared",
          spaceIds: [],
        })
        yield* ProfilesFixture.connect(found.organizationId, team.id, "MCP_GMAIL__TEAM", {
          hosts: ["gmail.example.com"],
        })
        yield* ProfilesFixture.connect(found.organizationId, team.id, "MCP_DRIVE__TEAM", {
          hosts: ["drive.example.com"],
        })
        yield* ProfilesFixture.connect(found.organizationId, other.id, "MCP_GMAIL__OTHER", {
          hosts: ["gmail.example.com"],
        })
        const resolve = (host: string, label: string) =>
          resolver.resolve(all, request(found.proof, host, [`ren:${label}`]))
        expect((yield* resolve("gmail.example.com", "MCP_GMAIL__TEAM")).allow).toBe(true)
        expect(yield* resolve("gmail.example.com", "MCP_GMAIL__OTHER")).toMatchObject({
          allow: false,
          reason: "credential_missing",
        })
        yield* apps.update(found.ada, app.id, {
          requiredCredentials: [],
          mcps: { gmail: ProfilesFixture.remote("Gmail") },
          skills: {},
          dependsOn: [],
          expectedRevision: app.revision,
        })
        expect(yield* resolve("drive.example.com", "MCP_DRIVE__TEAM")).toMatchObject({
          allow: false,
          reason: "credential_missing",
        })
      }),
  )

  it.live("Bob joins Ana's Personal Space: its next resolve denies her private profile's label (P42, P44)", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const members = yield* SpaceMember.Service
      const callers = yield* CredentialCallers.Service
      const found = yield* setup()
      const ana = found.ada
      const app = yield* ProfilesFixture.app(ana, found.space.id, "inbox", {
        mcps: { gmail: ProfilesFixture.remote("Gmail") },
      })
      const mine = yield* ProfilesFixture.profile(ana, { appId: app.id, slug: "ana", kind: "private" })
      yield* ProfilesFixture.connect(found.organizationId, mine.id, "MCP_GMAIL__ANA", { hosts: ["gmail.example.com"] })
      const spaces = yield* Space.Service
      const own = (yield* spaces.list(found.ada, { page: 1, pageSize: 50 })).items.find((space) =>
        space.name.endsWith("Personal Space"),
      )
      if (!own) return yield* Effect.die(new Error("expected Ana's Personal Space"))
      const brainId = Brain.ID.create()
      yield* Seed.session({ organizationId: found.organizationId, spaceId: own.id, createdBy: ana.userId, brainId })
      const placement = yield* callers.issue(
        { workload: { kind: "brain", id: brainId, generation: 1 }, organizationId: found.organizationId },
        "ProxyLogin",
      )
      if (placement.kind !== "ProxyLogin") return yield* Effect.die(new Error("expected a proxy login"))
      const proof: CredentialCallers.Proof = {
        kind: "ProxyLogin",
        username: placement.username,
        password: placement.password,
      }
      const resolve = resolver.resolve(all, request(proof, "gmail.example.com", ["ren:MCP_GMAIL__ANA"]))
      expect((yield* resolve).allow).toBe(true)
      const bob = yield* Seed.user({ name: "Bob" })
      yield* Seed.member(found.organizationId, bob.id, "member")
      invalidations.length = 0
      yield* members.create(found.ada, { spaceId: own.id, userId: bob.id })
      expect(yield* resolve).toMatchObject({ allow: false, reason: "credential_missing" })
      expect(invalidations).toContainEqual({ workload: `brain:${brainId}:` })
    }),
  )

  it.live("a provider route's expiry bounds the life of the egress answer (§14 rule 3)", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const database = yield* Database.Service
      const envelope = yield* Envelope.Service
      const found = yield* setup()
      const id = Credential.ID.create()
      const value = yield* envelope.seal(Redacted.make(encodeSealed({ type: "route", state: { token: "opaque" } })), {
        organizationId: found.organizationId,
        kind: "credential",
        id,
      })
      yield* database.db.insert(Database.Schema.credential).values({
        id,
        organization_id: found.organizationId,
        owner: "org",
        label: "MCP_MAIL",
        type: "route",
        provider: "timed",
        value,
        hosts: ["remote.timed.test"],
        inject: { op: "route" },
      })
      const reply = yield* resolver.resolve(all, request(found.proof, "remote.timed.test", ["ren:MCP_MAIL"]))
      expect(reply).toMatchObject({ allow: true, expiresAt: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000) })
      expect(values(reply)).toEqual([
        { op: "route", upstream: "https://remote.timed.test/v3" },
        { op: "setHeader", name: "authorization", value: "Bearer short" },
      ])
    }),
  )

})

describe("Egress.resolve, the person of a model request", () => {
  it.live("ren:PERSON of a member who can chat in the brain's space becomes that member's id", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const found = yield* setup()
      const admin = yield* Seed.user()
      const adminId = yield* Seed.member(found.organizationId, admin.id, "admin")
      const model = (memberId: string) =>
        resolver.resolve(all, request(found.proof, "models.ren.test", ["ren:MODELS", `ren:PERSON.${memberId}`]))

      expect(values(yield* model(found.memberId))).toEqual([
        { op: "replace", placeholder: "ren:MODELS", value: "sk-model", in: ["header"] },
        { op: "replace", placeholder: `ren:PERSON.${found.memberId}`, value: found.memberId, in: ["header"] },
      ])
      expect((yield* model(adminId)).allow).toBe(true)
    }),
  )

  it.live("ren:PERSON of someone outside the brain's space is refused with principal_scope and audited", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const found = yield* setup()
      const grace = yield* Seed.user()
      const outsideSpace = yield* Seed.member(found.organizationId, grace.id, "member")
      const otherOrganization = yield* Seed.member(yield* Seed.organization(), grace.id, "member")
      audits.length = 0

      const refused = yield* Effect.forEach([outsideSpace, otherOrganization, "mem_unknown"], (memberId) =>
        resolver.resolve(all, request(found.proof, "models.ren.test", ["ren:MODELS", `ren:PERSON.${memberId}`])),
      )

      expect(refused).toEqual(Array(3).fill({ allow: false, reason: "principal_scope", label: "PERSON" }))
      expect(audits.filter((each) => each.message === "Egress refused a model request for a person outside the brain's space")).toMatchObject(
        [outsideSpace, otherOrganization, "mem_unknown"].map((memberId) => ({
          annotations: { workload: `brain:${found.brainId}:1`, label: "PERSON", member: memberId, host: "models.ren.test" },
        })),
      )
    }),
  )

  it.live("removing a member from the space clears the egress answers, and the next request with their id is refused", () =>
    Effect.gen(function* () {
      const resolver = yield* Egress.Service
      const members = yield* SpaceMember.Service
      const found = yield* setup()
      const grace = yield* Seed.user()
      const graceId = yield* Seed.member(found.organizationId, grace.id, "member")
      const added = yield* members.create(found.ada, { spaceId: found.space.id, userId: grace.id })
      const model = resolver.resolve(all, request(found.proof, "models.ren.test", ["ren:MODELS", `ren:PERSON.${graceId}`]))
      expect((yield* model).allow).toBe(true)
      invalidations.length = 0

      yield* members.archive(found.ada, added.id)

      expect(invalidations).toContainEqual({ label: "PERSON" })
      expect(yield* model).toEqual({ allow: false, reason: "principal_scope", label: "PERSON" })
    }),
  )
})
