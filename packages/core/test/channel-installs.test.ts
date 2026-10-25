import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { createHmac } from "node:crypto"
import { Access } from "../src/access.js"
import type { Actor } from "../src/actor.js"
import { ChannelInstalls } from "../src/channel-installs.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { GitHub } from "../src/channel-provider/github.js"
import { GitHubApp } from "../src/github-app.js"
import { testEffect } from "./lib/effect.js"
import { GitHubServer } from "./lib/github-server.js"
import { Seed } from "./lib/seed.js"

const github = GitHubServer.start()
afterAll(() => github.stop())

const settings = (overrides: Record<string, string> = {}) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(GitHubServer.config(github.url, overrides)))

const it = testEffect(
  ChannelInstalls.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(ChannelProvider.layer([GitHub.provider]), Access.layer)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(settings()),
  ),
)

const client = Effect.gen(function* () {
  const found = yield* GitHubApp.settings
  if (Option.isNone(found)) return yield* Effect.die(new Error("The GitHub App settings did not load"))
  return yield* GitHubApp.make(found.value)
})

const app = testEffect(Layer.mergeAll(FetchHttpClient.layer, settings()))

const encoded = testEffect(
  Layer.mergeAll(
    FetchHttpClient.layer,
    settings({ GITHUB_APP_PRIVATE_KEY: Buffer.from(GitHubServer.privateKey).toString("base64") }),
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

const sign = (body: string, secret = "webhook-secret") =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

const request = (event: string, body: string, signature: string | null = sign(body)) => ({
  headers: new Headers({ "x-github-event": event, ...(signature !== null && { "x-hub-signature-256": signature }) }),
  body,
})

describe("GitHub", () => {
  app.live("verify refuses a bad, missing or other-secret signature and accepts the App's", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      const body = JSON.stringify({ zen: "Keep it logically awesome." })
      const outcomes = yield* Effect.forEach(
        [sign(body), "sha256=00", null, sign(body, "other-secret"), sign(`${body} `)],
        (signature) => Effect.exit(provider.verify(request("ping", body, signature))),
      )
      expect(outcomes.map((exit) => exit._tag)).toEqual(["Success", "Failure", "Failure", "Failure", "Failure"])
    }),
  )

  app.live("parse: ping is a handshake, installation deleted is an uninstall, and other events are ignored", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      expect(yield* provider.parse(request("ping", JSON.stringify({ zen: "z", hook_id: 1 })))).toEqual({
        _tag: "Handshake",
        body: {},
      })
      expect(
        yield* provider.parse(request("installation", JSON.stringify({ action: "deleted", installation: { id: 77 } }))),
      ).toEqual({ _tag: "Uninstalled", install: "77" })
      expect(
        yield* provider.parse(request("installation", JSON.stringify({ action: "created", installation: { id: 77 } }))),
      ).toMatchObject({ _tag: "Ignore" })
      expect((yield* Effect.flip(provider.parse(request("ping", "not json"))))._tag).toBe("ChannelProvider.Malformed")
    }),
  )

  app.effect("the App JWT is issued 60 seconds in the past and expires within 10 minutes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_800_000_000_000)
      const claims = GitHubServer.claimsOf(yield* (yield* client).jwt)
      expect(claims).toEqual({ iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: GitHubServer.appId })
    }),
  )

  encoded.live("a private key given as base64 of the PEM signs a JWT that GitHub accepts", () =>
    Effect.gen(function* () {
      const id = installation("acme")
      expect(yield* (yield* client).installation(id)).toEqual({ id: Number(id), account: { login: "acme" } })
    }),
  )

  app.effect("an installation token is kept until 5 minutes before it expires, then minted again", () =>
    Effect.gen(function* () {
      const minter = yield* client
      const id = installation("acme")
      const expiresAt = Date.parse(github.options.tokenExpiresAt)
      yield* TestClock.setTime(expiresAt - 60 * 60_000)
      const first = yield* minter.token(id)
      yield* TestClock.setTime(expiresAt - 5 * 60_000 - 1)
      expect(Redacted.value(yield* minter.token(id))).toBe(Redacted.value(first))
      yield* TestClock.setTime(expiresAt - 5 * 60_000)
      expect(Redacted.value(yield* minter.token(id))).not.toBe(Redacted.value(first))
      expect(github.minted.filter((each) => each === id)).toHaveLength(2)
    }),
  )

  app.live("without GITHUB_APP_ID, GitHub is off", () =>
    Effect.gen(function* () {
      expect(Option.isNone(yield* GitHubApp.settings)).toBe(true)
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
  )
})
