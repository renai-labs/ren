import { afterAll, describe, expect } from "bun:test"
import { ConfigProvider, Effect, Fiber, Layer, Logger, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { CredentialRefresh } from "../src/credential-refresh.js"
import { Credentials } from "../src/credentials.js"
import { Credential } from "@ren/schema/credential"
import { Mcp } from "@ren/schema/mcp"
import { McpProvider } from "../src/mcp-provider.js"
import { ComposioTest } from "./lib/composio.js"
import { ComposioServer } from "./lib/composio-server.js"
import { testEffect } from "./lib/effect.js"

const server = ComposioServer.start()
afterAll(() => server.stop())
const invalidated: Array<string> = []

const it = testEffect(ComposioTest.layer(server, invalidated))

const State = Schema.Struct({ sessionId: Schema.String, url: Schema.String })
const stateOf = (found: Effect.Success<ReturnType<typeof ComposioTest.stored>>) =>
  found?.value.type === "route" ? Schema.decodeUnknownSync(State)(found.value.state) : { sessionId: "", url: "" }
const sessionOf = (found: Effect.Success<ReturnType<typeof ComposioTest.stored>>) => stateOf(found).sessionId

const sent = (path: string, method = "POST") =>
  server.requests.filter((request) => request.path === path && request.method === method)

describe("Composio connect (§10, test 20 and 21)", () => {
  it.live(
    "the Composio user is the credential id; the session pins the account and turns off what the agent must not have",
    () =>
      Effect.gen(function* () {
        server.activeAfterReads = 1
        const found = yield* ComposioTest.setup()
        const started = yield* ComposioTest.connect(found)
        expect(started.redirect).toStartWith("https://connect.composio.test/link/")
        const link = sent("/api/v3.1/connected_accounts/link").at(-1)?.body
        expect(link?.user_id).toBe(started.credentialId)
        expect(link?.callback_url).toBe(`https://ren.test/oauth/callback?state=${started.state}`)
        expect(yield* ComposioTest.callback(started.state)).toMatchObject({ ok: true, label: ComposioTest.label })
        const session = sent("/api/v3.1/tool_router/session").at(-1)?.raw
        const accountId = [...server.accounts.keys()].at(-1)
        expect(session).toEqual({
          user_id: started.credentialId,
          toolkits: { enable: ["gmail"] },
          auth_configs: { gmail: server.authConfigs.at(0)?.id },
          connected_accounts: { gmail: [accountId] },
          manage_connections: { enable: false },
          workbench: { enable: false },
          proxy_execute: { enable: false },
          instant: false,
        })
        const saved = yield* ComposioTest.stored(ComposioTest.label)
        expect(saved?.row).toMatchObject({
          id: started.credentialId,
          type: "route",
          provider: "composio",
          provider_account_id: accountId,
          hosts: ["127.0.0.1"],
          inject: { op: "route" },
        })
        expect(stateOf(saved).url).toContain("/tool_router/")
        expect(server.requests.every((request) => request.apiKey === "composio-test-key")).toBe(true)
      }),
  )

  it.live("the auth config is found or created once per toolkit and then kept in memory", () =>
    Effect.gen(function* () {
      server.activeAfterReads = 1
      const before = sent("/api/v3.1/auth_configs", "GET").length + sent("/api/v3.1/auth_configs").length
      yield* ComposioTest.connect(yield* ComposioTest.setup())
      yield* ComposioTest.connect(yield* ComposioTest.setup())
      const after = sent("/api/v3.1/auth_configs", "GET").length + sent("/api/v3.1/auth_configs").length
      expect(after - before).toBeLessThanOrEqual(2)
      expect(server.authConfigs.filter((config) => config.toolkit === "gmail").length).toBe(1)
    }),
  )
})

describe("Composio reconnect, delete and 401 (tests 22 and 23)", () => {
  it.live(
    "a reconnect saves the new account first, then cleans up the old session and account; a delete cleans up both",
    () =>
      Effect.gen(function* () {
        const credentials = yield* Credentials.Service
        server.activeAfterReads = 1
        const found = yield* ComposioTest.setup()
        const first = yield* ComposioTest.connect(found)
        yield* ComposioTest.callback(first.state)
        const old = yield* ComposioTest.stored(ComposioTest.label)
        const oldSession = sessionOf(old)
        const oldAccount = old?.row.provider_account_id ?? ""
        server.activeAfterReads = 1
        const second = yield* ComposioTest.connect(found, { reconnect: true })
        expect(second.credentialId).toBe(first.credentialId)
        const cleanup = yield* McpProvider.Cleanup
        yield* ComposioTest.callback(second.state)
        yield* cleanup.wait({ provider: "composio", account: oldAccount })
        const now = yield* ComposioTest.stored(ComposioTest.label)
        expect(now?.row.revision).toBe(2)
        expect(now?.row.provider_account_id).not.toBe(oldAccount)
        expect(server.sessions.has(oldSession)).toBe(false)
        expect(server.accounts.has(oldAccount)).toBe(false)
        const deletes = server.requests.filter((request) => request.method === "DELETE").map((request) => request.path)
        expect(deletes.at(-1)).toBe(`/api/v3.1/connected_accounts/${oldAccount}`)
        expect(server.requests.at(-1)?.query.get("revoke_on_delete")).toBe("true")
        const nowSession = sessionOf(now)
        yield* credentials.remove(found.actor, first.credentialId, {})
        yield* cleanup.wait({ provider: "composio", account: now?.row.provider_account_id ?? "" })
        expect(server.sessions.has(nowSession)).toBe(false)
        expect(server.accounts.has(now?.row.provider_account_id ?? "")).toBe(false)
      }),
  )

  it.live("a 401 with an ACTIVE account makes a new session and cleans up only the old session; EXPIRED is fatal", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      server.activeAfterReads = 1
      const found = yield* ComposioTest.setup()
      const started = yield* ComposioTest.connect(found)
      yield* ComposioTest.callback(started.state)
      const before = yield* ComposioTest.stored(ComposioTest.label)
      const oldSession = sessionOf(before)
      const accountId = before?.row.provider_account_id ?? ""
      yield* refresh.refresh(started.credentialId, { revision: 1 })
      yield* (yield* McpProvider.Cleanup).wait({
        provider: "composio",
        state: before?.value.type === "route" ? before.value.state : undefined,
      })
      const after = yield* ComposioTest.stored(ComposioTest.label)
      expect(after?.row.revision).toBe(2)
      expect(sessionOf(after)).not.toBe(oldSession)
      expect(server.sessions.has(oldSession)).toBe(false)
      expect(server.accounts.has(accountId)).toBe(true)
      const account = server.accounts.get(accountId)
      if (account) account.status = "EXPIRED"
      yield* refresh.refresh(started.credentialId, { revision: 2 })
      expect((yield* ComposioTest.stored(ComposioTest.label))?.row.status).toBe("reconnect")
    }),
  )

  it.live("an active status is read once and kept for 5 minutes; Composio's words become Ren's", () =>
    Effect.gen(function* () {
      const registry = yield* McpProvider.Registry
      const provider = yield* registry.get("composio")
      server.accounts.set("ca_health", { status: "ACTIVE", userId: "crd_x", authConfigId: "ac" })
      server.accounts.set("ca_gone", { status: "EXPIRED", userId: "crd_x", authConfigId: "ac" })
      const reads = () => sent("/api/v3.1/connected_accounts/ca_health", "GET").length
      expect(yield* provider.status("ca_health")).toBe("active")
      expect(yield* provider.status("ca_health")).toBe("active")
      expect(reads()).toBe(1)
      expect(yield* provider.status("ca_gone")).toBe("gone")
    }),
  )
})

describe("Composio cleanup (test 22, K27)", () => {
  const logs: Array<string> = []
  const waiting: Array<() => void> = []
  const logged = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => (logs.length > count ? resolve() : waiting.push(check))
      check()
    })
  const logger = Logger.layer(
    [
      Logger.make((options) => {
        logs.push(`${options.logLevel}: ${String(options.message)}`)
        for (const check of waiting.splice(0)) check()
      }),
    ],
    { mergeWithExisting: true },
  )
  const cleanup = testEffect(
    McpProvider.layerComposio.pipe(
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ COMPOSIO_API_KEY: "composio-test-key", COMPOSIO_URL: server.url }),
        ),
      ),
    ),
  )

  cleanup.effect("a cleanup that keeps failing retries with a backoff and stops after 24 hours with an alert", () =>
    Effect.gen(function* () {
      const registry = yield* McpProvider.Registry
      const provider = yield* registry.get("composio")
      server.failDeletes = true
      const tries = () => sent("/api/v3.1/tool_router/session/trs_gone", "DELETE").length
      const before = tries()
      const seen = logs.length
      const run = yield* Effect.forkChild(
        McpProvider.cleanUp(provider, {
          state: { sessionId: "trs_gone", url: "", user: "", integration: "", account: "" },
        }),
      )
      yield* Effect.promise(() => logged(seen))
      // oxlint-disable-next-line ren/no-comments -- Each failure logs right before its backoff sleep starts; the clock moves only then, until the run ends.
      const step: Effect.Effect<void> = Effect.suspend(() => {
        const count = logs.length
        return TestClock.adjust("1 hour").pipe(
          Effect.andThen(
            Effect.raceFirst(
              Fiber.await(run).pipe(Effect.as(true)),
              Effect.promise(() => logged(count)).pipe(Effect.as(false)),
            ),
          ),
          Effect.flatMap((done) => (done ? Effect.void : step)),
        )
      })
      yield* step
      server.failDeletes = false
      const failures = logs.slice(seen).filter((message) => message.includes("cleanup failed")).length
      expect(tries() - before).toBeGreaterThan(0)
      expect(failures).toBeGreaterThan(5)
      expect(failures).toBeLessThan(40)
      expect(logs).toContain("Error: A provider's cleanup stopped after 24 hours")
    }).pipe(Effect.provide(logger)),
  )
})

describe("provider registry (§14, P38, P39)", () => {
  const opened: Array<unknown> = []
  // oxlint-disable-next-line ren/no-comments -- A second provider in its own layer: Ren needs no change outside it. Its state has a shape Core has never seen.
  const relay = Effect.succeed(
    Option.some<McpProvider.Provider>({
      id: "relay",
      connect: (input) =>
        Effect.succeed({ redirectUrl: `https://relay.test/connect?return=${input.callbackUrl}`, account: "acct_1" }),
      status: () => Effect.succeed("active"),
      open: (input) => Effect.succeed({ relay: { account: input.account, opaque: [1, 2, 3] } }),
      route: (state) =>
        Effect.sync(() => opened.push(state)).pipe(
          Effect.as({ upstream: Redacted.make("https://relay.test/mcp"), headers: [] }),
        ),
      renew: (state) => Effect.succeed(state),
      remove: () => Effect.void,
    }),
  )
  const registry = testEffect(
    McpProvider.layer([McpProvider.composio, relay]).pipe(Layer.provide(FetchHttpClient.layer)),
  )

  registry.effect(
    "a provider id with no layer is Unavailable; a second provider's layer adds it; Core keeps its state opaque",
    () =>
      Effect.gen(function* () {
        const providers = yield* McpProvider.Registry
        const missing = yield* Effect.flip(providers.get("pipedream"))
        expect(missing).toMatchObject({ _tag: "McpProvider.Unavailable" })
        expect((yield* Effect.flip(providers.get("composio")))._tag).toBe("McpProvider.Unavailable")
        const relay = yield* providers.get("relay")
        const state = yield* relay.open({
          credentialId: Credential.ID.create(),
          integration: "mail",
          account: "acct_1",
        })
        const sealed = Schema.decodeUnknownSync(Schema.fromJsonString(Credentials.Sealed))(
          Schema.encodeSync(Schema.fromJsonString(Credentials.Sealed))({ type: "route", state }),
        )
        expect(sealed.type === "route" && sealed.state).toEqual({ relay: { account: "acct_1", opaque: [1, 2, 3] } })
        expect(Redacted.value((yield* relay.route(state)).upstream)).toBe("https://relay.test/mcp")
        expect(opened).toEqual([state])
        const app = Schema.decodeUnknownExit(Mcp.Declaration)({
          name: "Mail",
          description: "Mail",
          transport: { type: "provider", provider: "pipedream", integration: "gmail" },
          auth: { type: "oauth", tokenEndpointAuth: "none" },
        })
        expect(app._tag).toBe("Success")
      }),
  )
})
