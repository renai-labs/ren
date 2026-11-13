export * as WebhookFixture from "./webhook-fixture.js"

import { Database } from "@ren/db/database"
import { App } from "@ren/schema/app"
import { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import { Webhook } from "@ren/schema/webhook"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import type { Actor } from "../../src/actor.js"
import { Envelope } from "../../src/envelope.js"
import { Intake } from "../../src/intake.js"
import { WebhookReceiver } from "../../src/webhook/receiver.js"
import { WebhookWorker } from "../../src/webhook/worker.js"
import { Webhooks } from "../../src/webhooks.js"
import { ChannelFixture } from "./channel-fixture.js"
import { Seed } from "./seed.js"

const config = ConfigProvider.layerAdd(
  ConfigProvider.fromUnknown({
    REN_URL: "https://ren.test",
    ENVELOPE_KEYS: JSON.stringify([
      { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
    ]),
  }),
  { asPrimary: true },
)

const origins = Layer.mergeAll(
  Intake.receivers(Effect.all([WebhookReceiver.make])),
  Intake.workers(Effect.all([WebhookWorker.make])),
).pipe(Layer.provide(Envelope.layerLocal))

export const layer = Webhooks.layer.pipe(
  Layer.provideMerge(ChannelFixture.intakeLayer(origins)),
  Layer.provide(Envelope.layerLocal),
  Layer.provide(config),
)

export const post = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
  options: { readonly method?: string; readonly bodyTooLarge?: boolean } = {},
): Effect.Effect<Intake.Reply, never, Intake.Service> =>
  Effect.flatMap(Intake.Service, (intake) => {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/")
    return intake.receive("webhook", {
      method: options.method ?? "POST",
      params: { id: parts.at(2) ?? "", token: parts.at(3) ?? "" },
      query: Object.fromEntries(parsed.searchParams),
      headers: new Headers({ "content-type": "application/json", ...headers }),
      body,
      ...(options.bodyTooLarge && { bodyTooLarge: true }),
    })
  })

export const decodeCreate = Schema.decodeUnknownSync(Webhook.CreateInput)

export const decodeUpdate = Schema.decodeUnknownSync(Webhook.UpdateInput)

const decodePreset = Schema.decodeUnknownSync(Webhook.Preset)

export const team = Effect.gen(function* () {
  const owner = yield* Seed.owner()
  const ada: Actor.Info = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
  const bob = yield* Seed.actor(owner.organizationId, "member")
  yield* Seed.join(owner.spaceId, bob.userId)
  return { ...owner, ada, bob }
})

export const signups = (spaceId: string) =>
  decodeCreate({
    spaceId,
    source: {
      _tag: "custom",
      name: "PostHog signups",
      message: "Research this person’s company.",
      parser: {
        signature: { kind: "header", header: "x-ren-secret" },
        filter: 'body.event.event == "user signed up"',
        eventId: "body.event.uuid",
        threadKey: "body.person.properties.email",
      },
    },
  })

export const pullRequests = decodePreset({
  name: "Pull requests",
  description: "Review each pull request that opens.",
  message: "Review this pull request.",
  signature: { kind: "hmac", header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
  filter: 'headers["x-github-event"] == "pull_request" && body.action == "opened"',
  eventId: 'headers["x-github-delivery"]',
  threadKey: "body.pull_request.html_url",
  secret: "ren",
  setup: "Paste the URL and the secret in the repository’s webhook settings.",
})

export const presetApp = Effect.fnUntraced(function* (
  organizationId: Auth.OrganizationID,
  webhooks: App.Definition["webhooks"],
  options: { readonly slug?: string } = {},
) {
  const database = yield* Database.Service
  const appId = App.ID.create()
  yield* database.db.insert(Database.Schema.app).values({
    id: appId,
    slug: options.slug ?? `github-${crypto.randomUUID().slice(0, 8)}`,
    name: "GitHub",
    description: "GitHub for Ren",
    required_credentials: [],
    mcps: {},
    skills: {},
    webhooks,
  })
  yield* database.db.insert(Database.Schema.app_profile).values({
    id: AppProfile.ID.create(),
    organization_id: organizationId,
    app_id: appId,
    slug: "default",
    name: "GitHub",
    kind: "shared",
    all_spaces: true,
  })
  return appId
})
