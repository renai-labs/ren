export * as SlackProvider from "./slack-provider.js"

import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChannelProvider } from "../../src/channel-provider.js"
import { Slack } from "../../src/channel-provider/slack.js"
import { ChannelSecrets } from "../../src/channel-secrets.js"
import { Envelope } from "../../src/envelope.js"
import { SlackApp } from "../../src/slack-app.js"
import { Seed } from "./seed.js"
import { SlackServer } from "./slack-server.js"

export const layer = (url: string) =>
  ChannelProvider.layer(Effect.all([Slack.provider])).pipe(
    Layer.provideMerge(SlackApp.layer),
    Layer.provideMerge(ChannelSecrets.layer),
    Layer.provideMerge(Envelope.layerLocal),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ...SlackServer.config(url),
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
        }),
      ),
    ),
  )

export const provider = Effect.flatMap(ChannelProvider.Registry, (registry) =>
  Option.match(registry.get("slack"), {
    onNone: () => Effect.die(new Error("Slack is not set up")),
    onSome: Effect.succeed,
  }),
)

export const installed = Effect.fnUntraced(function* (slack: SlackServer.Instance) {
  const database = yield* Database.Service
  const secrets = yield* ChannelSecrets.Service
  const organizationId = yield* Seed.organization()
  const workspace = `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const token = `xoxb-${crypto.randomUUID()}`
  slack.grants.set(`grant-${workspace}`, { team: workspace, teamName: "Acme", user: "U01", token })
  const id = ChannelInstall.ID.create()
  yield* database.db.insert(Database.Schema.channel_install).values({
    id,
    organization_id: organizationId,
    provider: "slack",
    workspace,
    name: "Acme",
    bot_user: "UBOT",
    secret: yield* secrets.seal(organizationId, id, Redacted.make(token)),
  })
  return { workspace, token }
})
