export * as ComposioTest from "./composio.js"

import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Mcp } from "@ren/schema/mcp"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../../src/access.js"
import { App } from "../../src/app.js"
import { AppProfiles } from "../../src/app/profiles.js"
import { CredentialRefresh } from "../../src/credential-refresh.js"
import { Credentials } from "../../src/credentials.js"
import { DurableRunner } from "../../src/durable-runner.js"
import { EgressControl } from "../../src/egress-control.js"
import { Envelope } from "../../src/envelope.js"
import { McpProvider } from "../../src/mcp-provider.js"
import { ProviderConnect } from "../../src/mcp-provider/connect.js"
import { OAuth } from "../../src/oauth.js"
import { OAuthFetch } from "../../src/oauth-fetch.js"
import type { ComposioServer } from "./composio-server.js"
import { Seed } from "./seed.js"

export const layer = (server: ComposioServer.Instance, invalidated: Array<string>) =>
  Layer.mergeAll(OAuth.layer, CredentialRefresh.layer, App.layer, AppProfiles.layer).pipe(
    Layer.provideMerge(ProviderConnect.layerRefresher),
    Layer.provideMerge(OAuth.layerRefresher),
    Layer.provideMerge(ProviderConnect.layer),
    Layer.provideMerge(Credentials.layer),
    Layer.provideMerge(McpProvider.layerCleanup),
    Layer.provideMerge(McpProvider.layerComposio),
    Layer.provideMerge(
      Layer.mergeAll(
        Access.layer,
        Envelope.layerLocal,
        OAuthFetch.layerUnchecked,
        DurableRunner.layerMemory,
        FetchHttpClient.layer,
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
          COMPOSIO_API_KEY: "composio-test-key",
          COMPOSIO_URL: server.url,
        }),
      ),
    ),
  )

const gmail: Mcp.Declaration = {
  name: "Gmail",
  description: "Gmail through Composio",
  transport: { type: "provider", provider: "composio", integration: "gmail" },
  auth: { type: "oauth", tokenEndpointAuth: "none" },
  requiredCredentials: [],
}

export const label = "MCP_GMAIL__TEAM"

export const setup = Effect.fnUntraced(function* () {
  const apps = yield* App.Service
  const profiles = yield* AppProfiles.Service
  const organizationId = yield* Seed.organization()
  const actor = yield* Seed.actor(organizationId, "admin")
  const space = yield* Seed.space(organizationId)
  yield* Seed.join(space, actor.userId)
  const app = yield* apps.create(
    actor,
    Seed.appInput(space, `google-${crypto.randomUUID().slice(0, 8)}`, { mcps: { gmail } }),
  )
  const profile = (yield* profiles.list(actor, { appId: app.id, page: 1, pageSize: 50 })).items.at(0)
  if (!profile) return yield* Effect.die(new Error("expected the owner-space profile"))
  return { actor, app, profile }
})

export const connect = Effect.fnUntraced(function* (
  found: Effect.Success<ReturnType<typeof setup>>,
  options: { readonly reconnect?: boolean } = {},
) {
  const oauth = yield* OAuth.Service
  const database = yield* Database.Service
  const result = yield* oauth.connect(found.actor, {
    profileId: found.profile.id,
    item: { mcp: "gmail" },
    ...(options.reconnect && { reconnect: true }),
  })
  if (!("redirectUrl" in result)) return yield* Effect.die(new Error("expected a redirect"))
  const session = (yield* database.db
    .select()
    .from(Database.Schema.oauth_session)
    .where(eq(Database.Schema.oauth_session.profile_id, found.profile.id))
    .orderBy(Database.Schema.oauth_session.created_at)).at(-1)
  if (!session) return yield* Effect.die(new Error("expected a sign-in session"))
  return { redirect: result.redirectUrl, state: session.state, credentialId: session.credential_id }
})

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Credentials.Sealed))

export const stored = Effect.fnUntraced(function* (label: string) {
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
  return { row, value: decode(Redacted.value(opened)) }
})

export const callback = Effect.fnUntraced(function* (state: string) {
  const oauth = yield* OAuth.Service
  return yield* oauth.callback({ state }, Option.none())
})
