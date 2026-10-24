import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { App as AppSchema } from "@ren/schema/app"
import { Credential } from "@ren/schema/credential"
import type { Mcp } from "@ren/schema/mcp"
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { AppRelease } from "../src/app/release.js"
import { CredentialRequirements } from "../src/credential-requirements.js"
import { Credentials } from "../src/credentials.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { McpProvider } from "../src/mcp-provider.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { SpaceApp } from "../src/space/app.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  Layer.mergeAll(CredentialRequirements.layer, App.layer, AppRelease.layer, SpaceApp.layer).pipe(
    Layer.provideMerge(Credentials.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        Access.layer,
        Envelope.layerLocal,
        EgressControl.layerNone,
        OAuthFetch.layerUnchecked,
        McpProvider.layerNone,
      ),
    ),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
        }),
      ),
    ),
  ),
)

const remote = (url: string, auth: Mcp.Auth = { type: "oauth", tokenEndpointAuth: "none" }): Mcp.Declaration => ({
  name: "Calendar",
  description: "Calendar",
  transport: { type: "remote", url },
  auth,
  requiredCredentials: [],
})

const encode = Schema.encodeSync(Schema.fromJsonString(Credentials.Sealed))

const connected = Effect.fnUntraced(function* (input: {
  readonly organizationId: Parameters<typeof Seed.space>[0]
  readonly owner: Credential.Owner
  readonly label: string
  readonly appId: AppSchema.ID
  readonly mcp: string
  readonly hosts: ReadonlyArray<string>
  readonly connection?: string
}) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const id = Credential.ID.create()
  const value = yield* envelope.seal(Redacted.make(encode({ type: "oauth", accessToken: Redacted.make("t") })), {
    organizationId: input.organizationId,
    kind: "credential",
    id,
  })
  yield* database.db.insert(Database.Schema.credential).values({
    id,
    organization_id: input.organizationId,
    owner: input.owner.kind,
    space_id: input.owner.kind === "space" ? input.owner.spaceId : null,
    user_id: input.owner.kind === "person" ? input.owner.userId : null,
    label: input.label,
    type: "oauth",
    value,
    hosts: [...input.hosts],
    inject: { op: "replace", in: ["header"] },
    app_id: input.appId,
    mcp: input.mcp,
    connection: input.connection ?? null,
  })
  return id
})

const slug = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`

describe("CredentialRequirements.forApp (§10a, tests 25, 26, 28)", () => {
  it.live("one item per MCP that signs in and per env key, then each dependency's items grouped by its app", () =>
    Effect.gen(function* () {
      const apps = yield* App.Service
      const requirements = yield* CredentialRequirements.Service
      const organizationId = yield* Seed.organization()
      const actor = yield* Seed.actor(organizationId, "admin")
      const space = yield* Seed.space(organizationId)
      const base = yield* apps.create(
        actor,
        Seed.appInput(space, slug("base"), {
          requiredCredentials: [{ kind: "env", name: "GOOGLE_PROJECT_ID", optional: false }],
        }),
      )
      const root = yield* apps.create(
        actor,
        Seed.appInput(space, slug("google"), {
          dependsOn: [base.slug],
          mcps: {
            calendar: remote("https://calendar.example.test/mcp"),
            gmail: {
              name: "Gmail",
              description: "Gmail",
              requiredCredentials: [],
              transport: { type: "provider", provider: "composio", toolkit: "gmail" },
              auth: { type: "none" },
            },
            docs: remote("https://docs.example.test/mcp", { type: "none" }),
          },
        }),
      )
      const found = yield* requirements.forApp(actor, { spaceId: space, appId: root.id })
      expect(found.items.map((item) => [item.group, item.mcp, item.label, item.kind, item.status])).toEqual([
        [root.id, "calendar", "MCP_CALENDAR", "oauth", "missing"],
        [root.id, "gmail", "MCP_GMAIL", "provider", "missing"],
        [base.id, null, "GOOGLE_PROJECT_ID", "env", "missing"],
      ])
    }),
  )

  it.live(
    "another app's credential with the same MCP slug does not count; a person credential is ok on release 1 and reconnect on release 2",
    () =>
      Effect.gen(function* () {
        const apps = yield* App.Service
        const releases = yield* AppRelease.Service
        const uses = yield* SpaceApp.Service
        const requirements = yield* CredentialRequirements.Service
        const organizationId = yield* Seed.organization()
        const actor = yield* Seed.actor(organizationId, "admin")
        const owner = yield* Seed.space(organizationId)
        const pinned = yield* Seed.space(organizationId)
        const other = yield* apps.create(
          actor,
          Seed.appInput(owner, slug("other"), { mcps: { calendar: remote("https://calendar.example.test/mcp") } }),
        )
        const input = Seed.appInput(owner, slug("calendar"), {
          mcps: { calendar: remote("https://calendar.example.test/mcp") },
        })
        yield* connected({
          organizationId,
          owner: { kind: "space", spaceId: owner },
          label: "MCP_CALENDAR",
          appId: other.id,
          mcp: "calendar",
          hosts: ["calendar.example.test"],
        })
        yield* apps.archive(actor, other.id)
        const app = yield* apps.create(actor, input)
        yield* uses.create(actor, { spaceId: pinned, appId: app.id, pinnedReleaseId: app.latestReleaseId })
        const status = (spaceId: typeof owner) =>
          Effect.map(requirements.forApp(actor, { spaceId, appId: app.id }), (found) => found.items.at(0)?.status)
        expect(yield* status(owner)).toBe("missing")
        yield* connected({
          organizationId,
          owner: { kind: "org" },
          label: "MCP_CALENDAR",
          appId: app.id,
          mcp: "calendar",
          hosts: ["calendar.example.test"],
        })
        expect(yield* status(owner)).toBe("ok")
        yield* releases.create(actor, {
          ...input,
          appId: app.id,
          expectedLatestReleaseId: app.latestReleaseId,
          version: "0.0.2",
          mcps: { calendar: remote("https://calendar-v2.example.test/mcp") },
        })
        expect(yield* status(pinned)).toBe("ok")
        expect(yield* status(owner)).toBe("reconnect")
      }),
  )

  it.live("only the default connection counts; a named one does not satisfy the item", () =>
    Effect.gen(function* () {
      const apps = yield* App.Service
      const requirements = yield* CredentialRequirements.Service
      const organizationId = yield* Seed.organization()
      const actor = yield* Seed.actor(organizationId, "admin")
      const space = yield* Seed.space(organizationId)
      const app = yield* apps.create(
        actor,
        Seed.appInput(space, slug("meta"), { mcps: { "meta-ads": remote("https://ads.example.test/mcp") } }),
      )
      yield* connected({
        organizationId,
        owner: { kind: "space", spaceId: space },
        label: "MCP_META_ADS__ACME",
        appId: app.id,
        mcp: "meta-ads",
        hosts: ["ads.example.test"],
        connection: "acme",
      })
      const item = () =>
        Effect.map(requirements.forApp(actor, { spaceId: space, appId: app.id }), (found) => found.items.at(0))
      expect((yield* item())?.status).toBe("missing")
      yield* connected({
        organizationId,
        owner: { kind: "space", spaceId: space },
        label: "MCP_META_ADS",
        appId: app.id,
        mcp: "meta-ads",
        hosts: ["ads.example.test"],
      })
      expect(yield* item()).toMatchObject({ status: "ok", label: "MCP_META_ADS", destinations: ["space", "org"] })
    }),
  )
})
