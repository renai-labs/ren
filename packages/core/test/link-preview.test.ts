import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { GitHubApp } from "../src/github-app.js"
import { LinkPreview } from "../src/link-preview.js"
import { SettingsRows } from "../src/settings/rows.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { GitHubServer } from "./lib/github-server.js"
import { ProfilesFixture } from "./lib/profiles.js"
import { Seed } from "./lib/seed.js"

const github = GitHubServer.start()

const seen: Array<{ readonly path: string; readonly authorization: string | null }> = []
const issues = new Map<string, unknown>()
const pages = new Map<string, unknown>()

const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url)
    seen.push({ path: url.pathname, authorization: request.headers.get("authorization") })
    if (url.pathname === "/graphql") {
      const body = Schema.decodeUnknownSync(Schema.Struct({ variables: Schema.Struct({ id: Schema.String }) }))(
        await request.json(),
      )
      return Response.json(issues.get(body.variables.id) ?? { data: { issue: null } })
    }
    const page = pages.get(url.pathname.replace("/v1/pages/", ""))
    return page ? Response.json(page) : new Response(null, { status: 404 })
  },
})

afterAll(() => {
  github.stop()
  void upstream.stop(true)
})

const githubLayer = GitHubApp.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    ConfigProvider.layerAdd(
      ConfigProvider.fromUnknown(GitHubServer.config(github.url, { GITHUB_URL: "https://github.com" })),
    ),
  ),
)

const it = testEffect(
  LinkPreview.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ProfilesFixture.layer,
        Configured.sessionLayerWith(githubLayer),
        githubLayer.pipe(Layer.provide(Testing.layer)),
      ),
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({ LINEAR_API_URL: upstream.url.origin, NOTION_API_URL: upstream.url.origin }),
      ),
    ),
  ),
)

const linearIssue = (identifier: string) => ({
  data: {
    issue: {
      identifier,
      url: `https://linear.app/acme/issue/${identifier}/ship-link-previews`,
      title: "Ship link previews",
      updatedAt: "2026-11-12T01:00:00.000Z",
      assignee: { name: "Shrey", avatarUrl: null },
      creator: null,
      state: { name: "In review", type: "started", color: "#f2c94c" },
    },
  },
})

const setup = Effect.fnUntraced(function* () {
  const organizationId = yield* Seed.organization()
  const root = yield* ProfilesFixture.user(organizationId, "Root", "admin")
  const ana = yield* ProfilesFixture.user(organizationId, "Ana")
  const bob = yield* ProfilesFixture.user(organizationId, "Bob")
  const outsider = yield* ProfilesFixture.user(organizationId, "Out")
  const space = yield* ProfilesFixture.space(ana, "Sales", [bob])
  const chat = yield* Seed.session({ organizationId, spaceId: space, createdBy: ana.userId })
  return { organizationId, root, ana, bob, outsider, space, chat }
})

const suffix = () => crypto.randomUUID().slice(0, 8).toUpperCase()

describe("LinkPreview", () => {
  it.live("a reader who cannot open the chat gets NotFound", () =>
    Effect.gen(function* () {
      const previews = yield* LinkPreview.Service
      const found = yield* setup()
      const error = yield* Effect.flip(previews.read(found.outsider, found.chat, ["https://linear.app/acme/issue/A-1"]))
      expect(error._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("a Linear status maps to its state, through the shared profile the space reaches", () =>
    Effect.gen(function* () {
      const previews = yield* LinkPreview.Service
      const found = yield* setup()
      const linear = yield* ProfilesFixture.app(found.root, found.root.personal, "linear")
      const profile = (yield* ProfilesFixture.profile(found.root, {
        appId: linear.id,
        slug: "sales",
        kind: "shared",
        spaceIds: [found.space],
      })).id
      yield* ProfilesFixture.connect(found.organizationId, profile, "LINEAR_SALES", { hosts: ["api.linear.app"] })
      const identifier = `RENAI-${suffix()}`
      issues.set(identifier, linearIssue(identifier))
      const url = `https://linear.app/acme/issue/${identifier}/ship-link-previews`
      const [preview] = yield* previews.read(found.bob, found.chat, [url])
      expect(preview).toMatchObject({
        kind: "linear_issue",
        url,
        ref: identifier,
        title: "Ship link previews",
        people: [{ name: "Shrey" }],
        state: { name: "In review", type: "started", color: "#f2c94c" },
      })
      expect(seen.findLast((request) => request.path === "/graphql")?.authorization).toBe("linear_sales-token")
    }),
  )

  it.live("a Linear link of another workspace than the connection's is no_access", () =>
    Effect.gen(function* () {
      const previews = yield* LinkPreview.Service
      const found = yield* setup()
      const linear = yield* ProfilesFixture.app(found.root, found.root.personal, "linear")
      const profile = (yield* ProfilesFixture.profile(found.root, {
        appId: linear.id,
        slug: "sales",
        kind: "shared",
        spaceIds: [found.space],
      })).id
      yield* ProfilesFixture.connect(found.organizationId, profile, "LINEAR_SALES", { hosts: ["api.linear.app"] })
      const identifier = `RENAI-${suffix()}`
      issues.set(identifier, linearIssue(identifier))
      const [preview] = yield* previews.read(found.bob, found.chat, [`https://linear.app/beta/issue/${identifier}`])
      expect(preview).toMatchObject({ kind: "unavailable", reason: "no_access" })
    }),
  )

  it.live(
    "another member's private profile is never used; the reader's own one is, in the reader's private space",
    () =>
      Effect.gen(function* () {
        const previews = yield* LinkPreview.Service
        const found = yield* setup()
        const linear = yield* ProfilesFixture.app(found.ana, found.space, "linear")
        const bobs = (yield* ProfilesFixture.profile(found.bob, { appId: linear.id, slug: "bob", kind: "private" })).id
        const anas = (yield* ProfilesFixture.profile(found.ana, { appId: linear.id, slug: "ana", kind: "private" })).id
        yield* ProfilesFixture.connect(found.organizationId, bobs, "LINEAR_BOB", { hosts: ["api.linear.app"] })
        yield* ProfilesFixture.connect(found.organizationId, anas, "LINEAR_ANA", { hosts: ["api.linear.app"] })
        const identifier = `RENAI-${suffix()}`
        issues.set(identifier, linearIssue(identifier))
        const url = `https://linear.app/acme/issue/${identifier}`
        const before = seen.length
        expect(yield* previews.read(found.bob, found.chat, [url])).toMatchObject([
          { kind: "unavailable", provider: "linear", reason: "not_connected", canConnect: true },
        ])
        expect(seen.length).toBe(before)
        const personal = yield* Seed.session({
          organizationId: found.organizationId,
          spaceId: found.ana.personal,
          createdBy: found.ana.userId,
        })
        expect(yield* previews.read(found.ana, personal, [url])).toMatchObject([
          { kind: "linear_issue", ref: identifier },
        ])
        expect(seen.findLast((request) => request.path === "/graphql")?.authorization).toBe("linear_ana-token")
      }),
  )

  it.live(
    "a Notion page shows its title and icon; a link that no app reaches is not connected and cannot connect",
    () =>
      Effect.gen(function* () {
        const previews = yield* LinkPreview.Service
        const found = yield* setup()
        const id = crypto.randomUUID()
        pages.set(id, {
          last_edited_time: "2026-11-11T10:00:00.000Z",
          icon: { type: "emoji", emoji: "🚀" },
          properties: {
            Tags: { type: "multi_select" },
            Name: { type: "title", title: [{ plain_text: "Launch plan" }] },
          },
        })
        const url = `https://www.notion.so/acme/Launch-plan-${id.replaceAll("-", "")}`
        expect(yield* previews.read(found.bob, found.chat, [url])).toMatchObject([
          { kind: "unavailable", provider: "notion", reason: "not_connected", canConnect: false },
        ])
        const notion = yield* ProfilesFixture.app(found.root, found.root.personal, "notion")
        const profile = (yield* ProfilesFixture.profile(found.root, {
          appId: notion.id,
          slug: "team",
          kind: "shared",
          spaceIds: [found.space],
        })).id
        expect(yield* previews.read(found.bob, found.chat, [`${url}?v=1`])).toMatchObject([
          { kind: "unavailable", reason: "not_connected", canConnect: true },
        ])
        yield* ProfilesFixture.connect(found.organizationId, profile, "NOTION_TEAM", { hosts: ["api.notion.com"] })
        expect(yield* previews.read(found.bob, found.chat, [`${url}?v=2`])).toMatchObject([
          { kind: "notion_page", ref: "Launch plan", title: "Launch plan", icon: { type: "emoji", value: "🚀" } },
        ])
        expect(seen.findLast((request) => request.path === `/v1/pages/${id}`)?.authorization).toBe(
          "Bearer notion_team-token",
        )
      }),
  )

  it.live("GitHub is read for the space's repositories only", () =>
    Effect.gen(function* () {
      const previews = yield* LinkPreview.Service
      const database = yield* Database.Service
      const found = yield* setup()
      const installation = String(Math.floor(Math.random() * 1e9))
      github.installations.set(installation, "acme")
      yield* database.db.insert(Database.Schema.channel_install).values({
        id: ChannelInstall.ID.create(),
        organization_id: found.organizationId,
        provider: "github",
        workspace: installation,
        name: "acme",
        installed_by: found.ana.userId,
      })
      const inside = `acme/web-${crypto.randomUUID().slice(0, 8)}`
      const outside = `acme/secret-${crypto.randomUUID().slice(0, 8)}`
      yield* database.transaction((transaction) =>
        SettingsRows.write(
          transaction,
          { space_id: found.space },
          {
            permissions: [],
            references: [{ alias: "web", repository: `https://github.com/${inside}`, description: "The web app" }],
          },
        ),
      )
      const pull = {
        title: "Fix the queue",
        state: "open",
        draft: true,
        head: { ref: "fix" },
        base: { ref: "main" },
        user: { login: "shrey" },
        updated_at: "2026-11-12T02:00:00Z",
      }
      github.resources.set(`/repos/${inside}/pulls/7`, pull)
      github.resources.set(`/repos/${inside}/issues/8`, { ...pull, state: "closed" })
      github.resources.set(`/repos/${outside}/pulls/1`, pull)
      const result = yield* previews.read(found.bob, found.chat, [
        `https://github.com/${inside}/pull/7`,
        `https://github.com/${inside}/issues/8`,
        `https://github.com/${outside}/pull/1`,
        "https://example.com/not-a-preview",
      ])
      expect(result).toMatchObject([
        { kind: "github_pr", ref: `${inside}#7`, title: "Fix the queue", state: "draft", people: [{ name: "shrey" }] },
        { kind: "github_issue", ref: `${inside}#8`, state: "closed" },
        { kind: "unavailable", provider: "github", reason: "no_access", canConnect: false },
      ])
    }),
  )
})
