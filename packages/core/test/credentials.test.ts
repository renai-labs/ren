import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Credential } from "@ren/schema/credential"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Exit, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { CredentialRefresh } from "../src/credential-refresh.js"
import { Credentials } from "../src/credentials.js"
import { DurableRunner } from "../src/durable-runner.js"
import { McpProvider } from "../src/mcp-provider.js"
import { OAuth } from "../src/oauth.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
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

const exchanges: Array<URLSearchParams> = []
const tokenAnswer: { status: number; body: unknown } = { status: 200, body: {} }
const tokens = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    exchanges.push(new URLSearchParams(await request.text()))
    return Response.json(tokenAnswer.body, { status: tokenAnswer.status })
  },
})
afterAll(() => tokens.stop(true))

const it = testEffect(
  Layer.mergeAll(CredentialRefresh.layer, Space.layer, SpaceMember.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(OAuth.layerRefresher),
    Layer.provideMerge(Credentials.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        Access.layer,
        Envelope.layerLocal,
        EgressControl.layerHttp,
        OAuthFetch.layerUnchecked,
        DurableRunner.layerMemory,
        McpProvider.layerNone,
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
          EGRESS_CONTROL_URLS: `http://127.0.0.1:${egress.port}`,
        }),
      ),
    ),
  ),
)

const page = { page: 1, pageSize: 50 }

const key = (value: string, hosts: ReadonlyArray<string> = ["api.stripe.com"]) => ({
  hosts,
  value: { type: "key" as const, value: Redacted.make(value) },
})

const user = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role = "member") {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role] }
})

const team = Effect.fnUntraced(function* () {
  const spaces = yield* Space.Service
  const members = yield* SpaceMember.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* user(organizationId)
  const grace = yield* user(organizationId)
  const admin = yield* user(organizationId, "admin")
  const space = yield* spaces.create(ada, { name: "Team" })
  const other = yield* spaces.create(grace, { name: "Other" })
  yield* members.create(ada, { spaceId: space.id, userId: grace.userId })
  return { organizationId, ada, grace, admin, space, other }
})

const accountCredential = Effect.fnUntraced(function* (
  owner: { readonly organizationId: Auth.OrganizationID; readonly holder: Auth.UserID },
  target: Credential.Owner,
  label: string,
) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const id = Credential.ID.create()
  const value = yield* envelope.seal(Redacted.make('{"type":"key","value":"ya29.token"}'), {
    organizationId: owner.organizationId,
    kind: "credential",
    id,
  })
  yield* database.db.insert(Database.Schema.credential).values({
    id,
    organization_id: owner.organizationId,
    owner: target.kind,
    space_id: target.kind === "space" ? target.spaceId : null,
    user_id: target.kind === "person" ? target.userId : null,
    label,
    type: "oauth",
    value,
    hosts: ["gmail.googleapis.com"],
    inject: { op: "setHeader", name: "Authorization", format: "Bearer {value}" },
    account_user_id: owner.holder,
    created_by_user_id: owner.holder,
  })
  return id
})

const failure = <A, E>(exit: Exit.Exit<A, E>) => (Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "success")

describe("Credentials: who may do what (owner-access §4)", () => {
  it.live(
    "members write org and space credentials; admins manage space ones without joining; space B stays hidden",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Credentials.Service
        const setup = yield* team()
        const org = yield* credentials.create(setup.ada, {
          owner: { kind: "org" },
          label: "STRIPE_API_KEY",
          ...key("sk_live_1234"),
        })
        expect(org).toMatchObject({ owner: { kind: "org" }, label: "STRIPE_API_KEY", keyPreview: "1234", type: "key" })
        const spaced = yield* credentials.create(setup.ada, {
          owner: { kind: "space", spaceId: setup.space.id },
          label: "LINEAR_API_KEY",
          ...key("lin_abcd", ["api.linear.app"]),
        })
        expect((yield* credentials.update(setup.admin, spaced.id, { name: "Linear" })).name).toBe("Linear")
        const hidden = yield* credentials.create(setup.grace, {
          owner: { kind: "space", spaceId: setup.other.id },
          label: "OTHER_KEY",
          ...key("other", ["api.other.dev"]),
        })
        const seen = (yield* credentials.list(setup.ada, page)).items.map((info) => info.label)
        expect(seen).toEqual(["LINEAR_API_KEY", "STRIPE_API_KEY"])
        expect(failure(yield* Effect.exit(credentials.get(setup.ada, hidden.id)))).toContain("Primitive.NotFound")
        expect(JSON.stringify(yield* credentials.list(setup.ada, page))).not.toContain("sk_live_1234")
      }),
  )

  it.live("an admin lists and deletes a person's credential, and cannot move it", () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.Service
      const setup = yield* team()
      const own = yield* credentials.create(setup.ada, {
        owner: { kind: "person", userId: setup.ada.userId },
        label: "OPENAI_API_KEY",
        ...key("sk-proj-9876", ["api.openai.com"]),
      })
      expect((yield* credentials.list(setup.admin, { ...page, owner: "person" })).items.map((info) => info.id)).toEqual(
        [own.id],
      )
      expect((yield* credentials.list(setup.grace, { ...page, owner: "person" })).items).toEqual([])
      const moved = yield* Effect.exit(credentials.move(setup.admin, own.id, { owner: { kind: "org" } }))
      expect(failure(moved)).toContain("Primitive.Forbidden")
      const forOther = yield* Effect.exit(
        credentials.create(setup.admin, {
          owner: { kind: "person", userId: setup.ada.userId },
          label: "SOMEONE_ELSES",
          ...key("x", ["api.openai.com"]),
        }),
      )
      expect(failure(forOther)).toContain("Primitive.Forbidden")
      yield* credentials.remove(setup.admin, own.id, {})
      expect((yield* credentials.list(setup.ada, { ...page, owner: "person" })).items).toEqual([])
    }),
  )

  it.live("only admins choose delivered for an org credential", () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.Service
      const setup = yield* team()
      const input = {
        owner: { kind: "org" as const },
        label: "PG_PASSWORD",
        delivery: "delivered" as const,
        ...key("pw", ["db.acme.dev"]),
      }
      expect(failure(yield* Effect.exit(credentials.create(setup.ada, input)))).toContain("Primitive.Forbidden")
      expect((yield* credentials.create(setup.admin, input)).delivery).toBe("delivered")
    }),
  )
})

describe("Credentials: store rules", () => {
  it.live(
    "a second label on one owner is LabelTaken; a rotate to another type is TypeChange; basic shows the username",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Credentials.Service
        const setup = yield* team()
        const made = yield* credentials.create(setup.ada, {
          owner: { kind: "org" },
          label: "STRIPE_API_KEY",
          ...key("sk_1"),
        })
        const again = yield* Effect.exit(
          credentials.create(setup.grace, { owner: { kind: "org" }, label: "STRIPE_API_KEY", ...key("sk_2") }),
        )
        expect(failure(again)).toContain("LabelTaken")
        expect(
          (yield* credentials.create(setup.ada, {
            owner: { kind: "space", spaceId: setup.space.id },
            label: "STRIPE_API_KEY",
            ...key("sk_3"),
          })).owner,
        ).toEqual({ kind: "space", spaceId: setup.space.id })
        const typed = yield* Effect.exit(
          credentials.rotate(setup.ada, made.id, {
            value: { type: "basic", username: "u", password: Redacted.make("p") },
          }),
        )
        expect(failure(typed)).toContain("TypeChange")
        const rotated = yield* credentials.rotate(setup.ada, made.id, {
          value: { type: "key", value: Redacted.make("sk_live_wxyz") },
        })
        expect(rotated.keyPreview).toBe("wxyz")
        const basic = yield* credentials.create(setup.ada, {
          owner: { kind: "org" },
          label: "JIRA",
          hosts: ["acme.atlassian.net"],
          value: { type: "basic", username: "ada@acme.dev", password: Redacted.make("secret") },
        })
        expect(basic).toMatchObject({
          keyPreview: "ada@acme.dev",
          inject: { op: "setHeader", name: "Authorization", format: "Basic {basic}" },
        })
      }),
  )

  it.live("two creates at 99 credentials: one succeeds, one gets LimitReached", () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.Service
      const setup = yield* team()
      const owner = { kind: "space" as const, spaceId: setup.space.id }
      yield* Effect.forEach(
        Array.from({ length: 99 }, (_, index) => `KEY_${index}`),
        (label) => credentials.create(setup.ada, { owner, label, ...key("v") }),
        { discard: true },
      )
      const exits = yield* Effect.all(
        ["KEY_A", "KEY_B"].map((label) => Effect.exit(credentials.create(setup.ada, { owner, label, ...key("v") }))),
        { concurrency: 2 },
      )
      expect(exits.filter(Exit.isSuccess).length).toBe(1)
      expect(exits.map(failure).filter((text) => text.includes("LimitReached")).length).toBe(1)
    }),
  )
})

describe("Credentials: client credentials (§10c, test 30)", () => {
  it.live(
    "a create exchanges once; the sweep exchanges again 20 minutes before expiry; invalid_client needs a reconnect; a rotate fixes it; a person owner is refused",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Credentials.Service
        const refresh = yield* CredentialRefresh.Service
        const database = yield* Database.Service
        const setup = yield* team()
        exchanges.length = 0
        tokenAnswer.status = 200
        tokenAnswer.body = { access_token: "shpat_1", token_type: "bearer", expires_in: "3600" }
        const value = (secret: string) => ({
          type: "client_credentials" as const,
          clientId: "shop-client",
          clientSecret: Redacted.make(secret),
          tokenEndpoint: `http://127.0.0.1:${tokens.port}/admin/oauth/access_token`,
        })
        const person = yield* Effect.exit(
          credentials.create(setup.ada, {
            owner: { kind: "person", userId: setup.ada.userId },
            label: "SHOPIFY",
            hosts: ["acme.myshopify.com"],
            value: value("s1"),
          }),
        )
        expect(failure(person)).toContain("Primitive.Invalid")
        expect(exchanges).toEqual([])
        const made = yield* credentials.create(setup.ada, {
          owner: { kind: "org" },
          label: "SHOPIFY",
          hosts: ["acme.myshopify.com"],
          inject: { op: "setHeader", name: "X-Shopify-Access-Token", format: "{value}" },
          value: value("s1"),
        })
        expect(
          exchanges.map((form) => [form.get("grant_type"), form.get("client_id"), form.get("client_secret")]),
        ).toEqual([["client_credentials", "shop-client", "s1"]])
        expect(made.expiresAt).not.toBeNull()
        const opened = yield* credentials.open(made.id)
        expect(
          Option.map(
            opened,
            (found) =>
              found.value.type === "client_credentials" &&
              found.value.accessToken &&
              Redacted.value(found.value.accessToken),
          ),
        ).toEqual(Option.some("shpat_1"))
        tokenAnswer.body = { access_token: "shpat_2", expires_in: 3600 }
        yield* database.db
          .update(Database.Schema.credential)
          .set({ expires_at: new Date(Date.now() + 19 * 60_000) })
          .where(eq(Database.Schema.credential.id, made.id))
        yield* Effect.all([refresh.sweep, refresh.sweep], { concurrency: 2 })
        expect(exchanges.length).toBe(2)
        tokenAnswer.status = 401
        tokenAnswer.body = { error: "invalid_client" }
        yield* refresh.refresh(made.id, {})
        expect((yield* credentials.get(setup.ada, made.id)).status).toBe("reconnect")
        tokenAnswer.status = 200
        tokenAnswer.body = { access_token: "shpat_3" }
        const rotated = yield* credentials.rotate(setup.ada, made.id, { value: value("s2") })
        expect(rotated).toMatchObject({ status: "ok", expiresAt: null })
        expect(exchanges.at(-1)?.get("client_secret")).toBe("s2")
        tokenAnswer.status = 400
        tokenAnswer.body = { error: "invalid_client", error_description: "Bad secret" }
        const refused = yield* Effect.exit(
          credentials.create(setup.ada, {
            owner: { kind: "org" },
            label: "SHOPIFY_TWO",
            hosts: ["b.myshopify.com"],
            value: value("x"),
          }),
        )
        expect(failure(refused)).toContain("invalid_client")
      }),
  )
})

describe("Credentials: move and copy (owner-access §4 rules 2 to 4)", () => {
  it.live(
    "only the holder moves an account credential, and only to a space they are in; a copy works for pasted keys only",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Credentials.Service
        const setup = yield* team()
        const gmail = yield* accountCredential(
          { organizationId: setup.organizationId, holder: setup.ada.userId },
          { kind: "person", userId: setup.ada.userId },
          "MCP_GMAIL",
        )
        const id = Credential.ID.make(gmail)
        expect(
          failure(
            yield* Effect.exit(credentials.move(setup.ada, id, { owner: { kind: "space", spaceId: setup.other.id } })),
          ),
        ).toContain("Primitive.")
        expect(failure(yield* Effect.exit(credentials.move(setup.ada, id, { owner: { kind: "org" } })))).toContain(
          "account_to_org",
        )
        const shared = yield* credentials.move(setup.ada, id, { owner: { kind: "space", spaceId: setup.space.id } })
        expect(shared).toMatchObject({ owner: { kind: "space" }, account: { userId: setup.ada.userId } })
        expect(failure(yield* Effect.exit(credentials.move(setup.grace, id, { owner: { kind: "org" } })))).toContain(
          "not_account_holder",
        )
        const opened = yield* credentials.open(id)
        expect(Option.map(opened, (found) => found.value.type)).toEqual(Option.some("key"))
        expect(failure(yield* Effect.exit(credentials.copy(setup.ada, id, { owner: { kind: "org" } })))).toContain(
          "copy_rotating",
        )
        const pasted = yield* credentials.create(setup.ada, {
          owner: { kind: "org" },
          label: "STRIPE_API_KEY",
          ...key("sk_live_1234"),
        })
        const copied = yield* credentials.copy(setup.ada, pasted.id, {
          owner: { kind: "space", spaceId: setup.space.id },
        })
        expect(copied).toMatchObject({ label: "STRIPE_API_KEY", owner: { kind: "space" }, keyPreview: "1234" })
        const copiedValue = yield* credentials.open(copied.id)
        expect(
          Option.map(copiedValue, (found) => found.value.type === "key" && Redacted.value(found.value.value)),
        ).toEqual(Option.some("sk_live_1234"))
        const elsewhere = yield* Seed.organization()
        const foreign = yield* Effect.exit(
          credentials.move(setup.ada, pasted.id, {
            owner: { kind: "space", spaceId: yield* Seed.space(elsewhere) },
          }),
        )
        expect(failure(foreign)).toContain("Primitive.NotFound")
      }),
  )
})

describe("Credentials: lookup (README §6.3, §6.4)", () => {
  const candidate = (
    label: string,
    owner: Credentials.OwnerKind,
    hosts: ReadonlyArray<string>,
    inject: Credential.Inject = { op: "replace", in: ["header"] },
  ): Credentials.Candidate => ({ id: `${owner}:${label}`, source: "static", label, owner, hosts, inject })

  it.effect("the first owner in the order workload, person, space, org wins; another host gets host_not_allowed", () =>
    Effect.sync(() => {
      const candidates = [
        candidate("STRIPE_API_KEY", "org", ["api.stripe.com"]),
        candidate("STRIPE_API_KEY", "space", ["api.stripe.com"]),
        candidate("STRIPE_API_KEY", "person", ["api.stripe.com"]),
      ]
      const found = Credentials.match(candidates, {
        host: "api.stripe.com",
        placeholders: ["ren:STRIPE_API_KEY"],
      })
      expect(found.ok && found.matches.map((matched) => matched.candidate.owner)).toEqual(["person"])
      expect(Credentials.match(candidates, { host: "evil.example.com", placeholders: ["ren:STRIPE_API_KEY"] })).toEqual(
        { ok: false, reason: "host_not_allowed", label: "STRIPE_API_KEY" },
      )
      expect(Credentials.match(candidates, { host: "api.stripe.com", placeholders: ["ren:MISSING"] })).toEqual({
        ok: false,
        reason: "credential_missing",
        label: "MISSING",
      })
    }),
  )

  it.effect("two credentials that inject by host for one host, without a placeholder, are ambiguous", () =>
    Effect.sync(() => {
      const header: Credential.Inject = { op: "setHeader", name: "Authorization", format: "Bearer {value}" }
      const candidates = [
        candidate("GITHUB", "space", ["api.github.com"], header),
        candidate("GITHUB_BOT", "org", ["api.github.com"], header),
      ]
      expect(Credentials.match(candidates, { host: "api.github.com", placeholders: [] })).toEqual({
        ok: false,
        reason: "ambiguous",
      })
      const one = Credentials.match(candidates.slice(0, 1), { host: "api.github.com", placeholders: [] })
      expect(one.ok && one.matches.map((matched) => matched.candidate.label)).toEqual(["GITHUB"])
      expect(Credentials.match(candidates, { host: "api.stripe.com", placeholders: [] })).toEqual({
        ok: true,
        matches: [],
      })
    }),
  )

  it.live(
    "a person credential reaches only a session-scope brain of that person; another space's label never does",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Credentials.Service
        const setup = yield* team()
        yield* credentials.create(setup.ada, {
          owner: { kind: "person", userId: setup.ada.userId },
          label: "OPENAI_API_KEY",
          ...key("sk-proj", ["api.openai.com"]),
        })
        yield* credentials.create(setup.grace, {
          owner: { kind: "space", spaceId: setup.other.id },
          label: "OTHER_KEY",
          ...key("other", ["api.other.dev"]),
        })
        const sessionId = yield* Seed.session({
          organizationId: setup.organizationId,
          spaceId: setup.space.id,
          createdBy: setup.ada.userId,
        })
        const spaceBrain = Brain.ID.create()
        yield* Seed.session({
          organizationId: setup.organizationId,
          spaceId: setup.space.id,
          createdBy: setup.ada.userId,
          brainId: spaceBrain,
        })
        const labels = (brainId: Brain.ID) =>
          Effect.gen(function* () {
            const scope = yield* credentials.scopeOf({ kind: "brain", id: brainId, generation: 1 })
            if (Option.isNone(scope)) return []
            return (yield* credentials.candidates(scope.value)).map((found) => found.label).toSorted()
          })
        expect(yield* labels(Brain.ofSession(sessionId))).toEqual(["OPENAI_API_KEY"])
        expect(yield* labels(spaceBrain)).toEqual([])
      }),
  )
})

describe("Credentials: offboarding (owner-access §11)", () => {
  it.live(
    "leaving a space removes the account credentials there and keeps a pasted key; the brain stops reaching space credentials",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Credentials.Service
        const members = yield* SpaceMember.Service
        const setup = yield* team()
        const owner = { kind: "space" as const, spaceId: setup.space.id }
        yield* accountCredential(
          { organizationId: setup.organizationId, holder: setup.grace.userId },
          owner,
          "MCP_GMAIL",
        )
        yield* credentials.create(setup.grace, { owner, label: "STRIPE_API_KEY", ...key("sk_1") })
        const sessionId = yield* Seed.session({
          organizationId: setup.organizationId,
          spaceId: setup.space.id,
          createdBy: setup.grace.userId,
        })
        const brain = { kind: "brain" as const, id: Brain.ofSession(sessionId), generation: 1 }
        const before = yield* credentials.scopeOf(brain)
        expect(Option.map(before, (scope) => scope.spaceId)).toEqual(Option.some(Option.some(setup.space.id)))
        invalidations.length = 0
        const membership = (yield* members.list(setup.ada, { ...page, spaceId: setup.space.id })).items.find(
          (member) => member.status === "active" && member.userId === setup.grace.userId,
        )
        if (!membership) return yield* Effect.die(new Error("Grace is not in the space"))
        yield* members.archive(setup.ada, membership.id)
        expect(
          (yield* credentials.list(setup.ada, { ...page, spaceId: setup.space.id })).items.map((info) => info.label),
        ).toEqual(["STRIPE_API_KEY"])
        const after = yield* credentials.scopeOf(brain)
        expect(Option.map(after, (scope) => Option.isNone(scope.spaceId) && Option.isNone(scope.person))).toEqual(
          Option.some(true),
        )
        expect(invalidations).toContainEqual({ label: "MCP_GMAIL" })
        expect(invalidations).toContainEqual({ workload: `brain:${brain.id}:` })
      }),
  )

  it.live("leaving the org removes person and account credentials; archiving a space removes its credentials", () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.Service
      const provisioning = yield* SpaceProvisioning.Service
      const spaces = yield* Space.Service
      const database = yield* Database.Service
      const setup = yield* team()
      yield* credentials.create(setup.grace, {
        owner: { kind: "person", userId: setup.grace.userId },
        label: "OPENAI_API_KEY",
        ...key("sk-proj", ["api.openai.com"]),
      })
      yield* accountCredential(
        { organizationId: setup.organizationId, holder: setup.grace.userId },
        { kind: "space", spaceId: setup.space.id },
        "MCP_GMAIL",
      )
      yield* credentials.create(setup.grace, {
        owner: { kind: "space", spaceId: setup.space.id },
        label: "STRIPE_API_KEY",
        ...key("sk"),
      })
      yield* provisioning.archiveMemberships(setup.organizationId, setup.grace.userId)
      const left = yield* database.db
        .select({ label: Database.Schema.credential.label })
        .from(Database.Schema.credential)
        .where(eq(Database.Schema.credential.organization_id, setup.organizationId))
      expect(left.map((row) => row.label)).toEqual(["STRIPE_API_KEY"])
      yield* spaces.archive(setup.ada, setup.space.id)
      const archived = yield* database.db
        .select({ label: Database.Schema.credential.label })
        .from(Database.Schema.credential)
        .where(eq(Database.Schema.credential.organization_id, setup.organizationId))
      expect(archived).toEqual([])
    }),
  )
})

describe("Credentials: env vars of a workload (A35, C9)", () => {
  it.live("each pasted key that reaches a brain becomes LABEL=ren:LABEL; a delivered key gives its value", () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.Service
      const setup = yield* team()
      yield* credentials.create(setup.ada, { owner: { kind: "org" }, label: "STRIPE_API_KEY", ...key("sk_live_1234") })
      yield* credentials.create(setup.admin, {
        owner: { kind: "org" },
        label: "PG_PASSWORD",
        delivery: "delivered",
        ...key("pg-secret", ["db.acme.dev"]),
      })
      yield* credentials.create(setup.ada, {
        owner: { kind: "org" },
        label: "JIRA",
        hosts: ["acme.atlassian.net"],
        value: { type: "basic", username: "ada", password: Redacted.make("p") },
      })
      const brainId = Brain.ID.create()
      yield* Seed.session({
        organizationId: setup.organizationId,
        spaceId: setup.space.id,
        createdBy: setup.ada.userId,
        brainId,
      })
      const scope = yield* credentials.scopeOf({ kind: "brain", id: brainId, generation: 1 })
      if (Option.isNone(scope)) return yield* Effect.die(new Error("no scope"))
      expect(yield* credentials.environment(scope.value)).toEqual({
        STRIPE_API_KEY: "ren:STRIPE_API_KEY",
        PG_PASSWORD: "pg-secret",
      })
    }),
  )
})
