import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import type { Actor } from "../src/actor.js"
import { ChannelInstalls } from "../src/channel-installs.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { GitHub } from "../src/channel-provider/github.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { GitHubAccounts } from "../src/github-accounts.js"
import { GitHubApp } from "../src/github-app.js"
import { PersonCredentials } from "../src/person-credentials.js"
import { testEffect } from "./lib/effect.js"
import { GitHubServer } from "./lib/github-server.js"
import { Seed } from "./lib/seed.js"

const github = GitHubServer.start()
afterAll(() => github.stop())

const settings = (overrides: Record<string, string> = {}) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      ...GitHubServer.config(github.url, overrides),
      ENVELOPE_KEYS: JSON.stringify([
        { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
      ]),
    }),
  )

const it = testEffect(
  ChannelInstalls.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(ChannelProvider.layer([GitHub.provider]), Access.layer)),
    Layer.provideMerge(GitHubAccounts.layer),
    Layer.provideMerge(GitHubApp.layer),
    Layer.provideMerge(
      PersonCredentials.layer.pipe(Layer.provideMerge(Layer.mergeAll(Envelope.layerLocal, EgressControl.layerNone))),
    ),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(settings()),
  ),
)

const installation = (login: string) => {
  const id = String(Math.floor(Math.random() * 1e9))
  github.installations.set(id, login)
  return id
}

const authorized = (...installations: ReadonlyArray<string>) => {
  const code = `code-${crypto.randomUUID()}`
  github.users.set(code, installations)
  return code
}

const started = Effect.fnUntraced(function* (actor: Actor.Info) {
  const installs = yield* ChannelInstalls.Service
  const redirect = yield* installs.start(actor, { provider: "github" })
  const url = new URL(redirect.redirectUrl)
  return url.searchParams.get("state") ?? ""
})

const finish = (state: string, query: Record<string, string>) =>
  Effect.flatMap(ChannelInstalls.Service, (installs) =>
    installs.complete("github", { state, setup_action: "install", ...query }, Option.none()),
  )

const member = Effect.fnUntraced(function* (role = "member") {
  const organizationId = yield* Seed.organization()
  return yield* Seed.actor(organizationId, role)
})

describe("ChannelInstalls with GitHub", () => {
  it.live("an installer cannot link a GitHub account owned by another Ren user", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const actor = yield* member()
      const other = yield* Seed.user()
      const id = installation("acme")
      const code = authorized(id)
      yield* database.db.insert(Database.Schema.account).values({
        id: Auth.AccountID.create(),
        providerId: "github",
        accountId: String(7000 + code.length),
        userId: other.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      expect(yield* finish(yield* started(actor), { installation_id: id, code })).toMatchObject({ ok: false })
      expect(
        yield* database.db
          .select()
          .from(Database.Schema.credential)
          .where(eq(Database.Schema.credential.user_id, actor.userId)),
      ).toEqual([])
    }),
  )

  it.live(
    "start sends the person to the App's install page with a one-time state; the callback stores the install",
    () =>
      Effect.gen(function* () {
        const installs = yield* ChannelInstalls.Service
        const actor = yield* member()
        const redirect = yield* installs.start(actor, { provider: "github" })
        const url = new URL(redirect.redirectUrl)
        expect(`${url.origin}${url.pathname}`).toBe(`${github.url}/apps/ren-test/installations/new`)
        const state = url.searchParams.get("state") ?? ""
        const id = installation("acme")
        const code = authorized(id)
        expect(yield* finish(state, { installation_id: id, code })).toEqual({
          ok: true,
          provider: "github",
          name: "acme",
        })
        expect(yield* finish(state, { installation_id: id, code })).toEqual({
          ok: false,
          reason: "This install link was already used, or Ren did not make it. Start the install again.",
        })
        expect((yield* installs.list(actor, { page: 1, pageSize: 50 })).items).toMatchObject([
          { provider: "github", workspace: id, name: "acme", installedBy: { id: actor.userId, name: "Ada" } },
        ])
      }),
  )

  it.live(
    "the install links the installer's GitHub account and keeps their sealed token as their GITHUB credential",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const envelope = yield* Envelope.Service
        const actor = yield* member()
        const id = installation("acme")
        const code = authorized(id)
        yield* finish(yield* started(actor), { installation_id: id, code })
        const login = `person-${code.slice(-6)}`
        expect(
          yield* database.db
            .select({ providerId: Database.Schema.account.providerId, accountId: Database.Schema.account.accountId })
            .from(Database.Schema.account)
            .where(eq(Database.Schema.account.userId, actor.userId)),
        ).toEqual([{ providerId: "github", accountId: String(7000 + code.length) }])
        const credential = (yield* database.db
          .select()
          .from(Database.Schema.credential)
          .where(eq(Database.Schema.credential.user_id, actor.userId))).at(0)
        expect(credential).toMatchObject({
          owner: "person",
          organization_id: actor.organizationId,
          label: "GITHUB",
          type: "oauth",
          name: login,
          provider_account_id: String(7000 + code.length),
          hosts: ["api", "", "codeload", "uploads"].map((sub) =>
            [sub, new URL(github.url).hostname].filter(Boolean).join("."),
          ),
        })
        if (!credential) return yield* Effect.die(new Error("No credential"))
        expect(JSON.stringify(credential.value)).not.toContain(`user:${code}`)
        const opened = yield* envelope.open(credential.value, {
          organizationId: actor.organizationId,
          kind: "credential",
          id: credential.id,
        })
        expect(JSON.parse(Redacted.value(opened))).toMatchObject({
          type: "oauth",
          accessToken: `user:${code}`,
          refresh: { refreshToken: `refresh:${code}`, tokenEndpoint: `${github.url}/login/oauth/access_token` },
        })
      }),
  )

  it.live("an expired link, another signed-in person or a person who left the organization cannot finish", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const actor = yield* member()
      const id = installation("acme")
      const expired = yield* started(actor)
      yield* database.db
        .update(Database.Schema.channel_install_state)
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where(eq(Database.Schema.channel_install_state.state, expired))
      expect(yield* finish(expired, { installation_id: id, code: authorized(id) })).toEqual({
        ok: false,
        reason: "This install link expired. Start the install again.",
      })
      const other = yield* Seed.user()
      const installs = yield* ChannelInstalls.Service
      const state = yield* started(actor)
      expect(
        yield* installs.complete("github", { state, installation_id: id, code: authorized(id) }, Option.some(other.id)),
      ).toEqual({
        ok: false,
        reason: "You are signed in to Ren as someone other than the person who started this install.",
      })
      const left = yield* started(actor)
      yield* database.db.delete(Database.Schema.member).where(eq(Database.Schema.member.userId, actor.userId))
      expect(yield* finish(left, { installation_id: id, code: authorized(id) })).toEqual({
        ok: false,
        reason: "You are no longer a member of the organization that started this install.",
      })
      expect(yield* database.db.select().from(Database.Schema.channel_install)).toEqual([])
    }),
  )

  it.live("GitHub must confirm that the person reaches the installation", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const actor = yield* member()
      const id = installation("acme")
      expect(yield* finish(yield* started(actor), { installation_id: id, code: "unknown-code" })).toEqual({
        ok: false,
        reason: "GitHub did not confirm the install. Try again.",
      })
      expect(
        yield* finish(yield* started(actor), { installation_id: id, code: authorized(installation("other")) }),
      ).toEqual({ ok: false, reason: "Your GitHub account cannot reach this installation." })
      expect(yield* finish(yield* started(actor), { installation_id: id })).toMatchObject({ ok: false })
      expect(
        yield* finish(yield* started(actor), { installation_id: id, code: authorized(id), setup_action: "request" }),
      ).toMatchObject({ ok: false })
      expect(yield* database.db.select().from(Database.Schema.channel_install)).toEqual([])
    }),
  )

  it.live("a return from GitHub after a change of repository access, with no state, installs nothing", () =>
    Effect.gen(function* () {
      const installs = yield* ChannelInstalls.Service
      const database = yield* Database.Service
      expect(
        yield* installs.complete(
          "github",
          { installation_id: installation("acme"), setup_action: "update" },
          Option.none(),
        ),
      ).toEqual({ ok: true, provider: "github", name: null })
      expect(
        yield* installs.complete("github", { installation_id: "1", setup_action: "install" }, Option.none()),
      ).toMatchObject({
        ok: false,
      })
      expect(yield* database.db.select().from(Database.Schema.channel_install)).toEqual([])
    }),
  )

  it.live("a user code that reaches more than one page of installations still finds the installation", () =>
    Effect.gen(function* () {
      const actor = yield* member()
      const ids = Array.from({ length: 150 }, () => installation("many"))
      const last = ids.at(-1) ?? ""
      expect(yield* finish(yield* started(actor), { installation_id: last, code: authorized(...ids) })).toMatchObject({
        ok: true,
      })
    }),
  )

  it.live(
    "a workspace of another organization is refused, a second GitHub of one organization is refused, and a reinstall keeps its row",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const first = yield* member()
        const id = installation("acme")
        yield* finish(yield* started(first), { installation_id: id, code: authorized(id) })
        const stranger = yield* member()
        expect(yield* finish(yield* started(stranger), { installation_id: id, code: authorized(id) })).toEqual({
          ok: false,
          reason:
            "This GitHub workspace is connected to another organization. Switch to that organization, then try again.",
        })
        const colleague = yield* Seed.actor(first.organizationId, "member")
        const second = installation("other")
        expect(yield* finish(yield* started(colleague), { installation_id: second, code: authorized(second) })).toEqual(
          {
            ok: false,
            reason: "This organization already has GitHub connected: acme.",
          },
        )
        github.installations.set(id, "acme-renamed")
        expect(yield* finish(yield* started(first), { installation_id: id, code: authorized(id) })).toMatchObject({
          ok: true,
          name: "acme-renamed",
        })
        expect(
          (yield* database.db.select().from(Database.Schema.channel_install)).map((row) => [row.workspace, row.name]),
        ).toEqual([[id, "acme-renamed"]])
      }),
  )

  it.live(
    "a member who did not install cannot remove it; the installer can, and Ren deletes the installation on GitHub",
    () =>
      Effect.gen(function* () {
        const installs = yield* ChannelInstalls.Service
        const installer = yield* member()
        const id = installation("acme")
        yield* finish(yield* started(installer), { installation_id: id, code: authorized(id) })
        const install = (yield* installs.list(installer, { page: 1, pageSize: 50 })).items.at(0)
        if (!install) return yield* Effect.die(new Error("No install"))
        const colleague = yield* Seed.actor(installer.organizationId, "member")
        expect(yield* Effect.flip(installs.remove(colleague, install.id, {}))).toMatchObject({
          _tag: "Primitive.Forbidden",
        })
        expect(yield* installs.remove(installer, install.id, {})).toMatchObject({ id: install.id, name: "acme" })
        expect(github.deleted).toContain(id)
        expect((yield* installs.list(installer, { page: 1, pageSize: 50 })).items).toEqual([])
      }),
  )

  it.live("an admin removes an install even when GitHub fails or no longer has the installation", () =>
    Effect.gen(function* () {
      const installs = yield* ChannelInstalls.Service
      const installer = yield* member()
      const admin = yield* Seed.actor(installer.organizationId, "admin")
      const id = installation("acme")
      yield* finish(yield* started(installer), { installation_id: id, code: authorized(id) })
      const install = (yield* installs.list(admin, { page: 1, pageSize: 50 })).items.at(0)
      if (!install) return yield* Effect.die(new Error("No install"))
      github.options.failDelete = true
      yield* installs
        .remove(admin, install.id, {})
        .pipe(Effect.ensuring(Effect.sync(() => (github.options.failDelete = false))))
      expect((yield* installs.list(admin, { page: 1, pageSize: 50 })).items).toEqual([])
      const gone = installation("gone")
      yield* finish(yield* started(installer), { installation_id: gone, code: authorized(gone) })
      github.installations.delete(gone)
      const again = (yield* installs.list(admin, { page: 1, pageSize: 50 })).items.at(0)
      if (!again) return yield* Effect.die(new Error("No install"))
      expect(yield* installs.remove(admin, again.id, {})).toMatchObject({ id: again.id })
    }),
  )
})

describe("GitHubAccounts", () => {
  it.live(
    "a GitHub sign-in becomes the person's GITHUB credential in each of their organizations, the account keeps no token, and an unlink removes it",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const accounts = yield* GitHubAccounts.Service
        const first = yield* member()
        const second = yield* Seed.organization()
        yield* Seed.member(second, first.userId, "member")
        const code = authorized()
        const account = Auth.AccountID.create()
        yield* database.db.insert(Database.Schema.account).values({
          id: account,
          providerId: "github",
          accountId: String(7000 + code.length),
          userId: first.userId,
          accessToken: `user:${code}`,
          refreshToken: `refresh:${code}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        yield* accounts.sync(first.userId)
        const saved = yield* database.db
          .select({ organizationId: Database.Schema.credential.organization_id, name: Database.Schema.credential.name })
          .from(Database.Schema.credential)
          .where(eq(Database.Schema.credential.user_id, first.userId))
        expect(saved.map((row) => row.organizationId).toSorted()).toEqual([first.organizationId, second].toSorted())
        expect(saved.every((row) => row.name === `person-${code.slice(-6)}`)).toBe(true)
        expect(
          yield* database.db
            .select({
              accessToken: Database.Schema.account.accessToken,
              refreshToken: Database.Schema.account.refreshToken,
            })
            .from(Database.Schema.account)
            .where(eq(Database.Schema.account.id, account)),
        ).toEqual([{ accessToken: null, refreshToken: null }])
        yield* database.db.delete(Database.Schema.account).where(eq(Database.Schema.account.id, account))
        yield* accounts.disconnect(first.userId)
        expect(
          yield* database.db
            .select()
            .from(Database.Schema.credential)
            .where(eq(Database.Schema.credential.user_id, first.userId)),
        ).toEqual([])
      }),
  )
})
