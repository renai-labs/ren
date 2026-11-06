export * as WebhookFixture from "./webhook-fixture.js"

import { Webhook } from "@ren/schema/webhook"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import type { Actor } from "../../src/actor.js"
import { Envelope } from "../../src/envelope.js"
import { Intake } from "../../src/intake.js"
import { IntakeThreads } from "../../src/intake-threads.js"
import { WebhookIntake } from "../../src/webhook-intake.js"
import { Webhooks } from "../../src/webhooks.js"
import { ChannelFixture } from "./channel-fixture.js"
import { Seed } from "./seed.js"

export const layer = Webhooks.layer.pipe(
  Layer.provide(Layer.mergeAll(Envelope.layerLocal, IntakeThreads.layer)),
  Layer.provideMerge(
    ChannelFixture.intakeLayer(
      Intake.sources(Effect.all([WebhookIntake.source])).pipe(Layer.provide(Envelope.layerLocal)),
    ),
  ),
  Layer.provide(
    ConfigProvider.layerAdd(
      ConfigProvider.fromUnknown({
        REN_URL: "https://ren.test",
        ENVELOPE_KEYS: JSON.stringify([
          { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
        ]),
      }),
    ),
  ),
)

export const decodeCreate = Schema.decodeUnknownSync(Webhook.CreateInput)

export const owner = Effect.gen(function* () {
  const seeded = yield* Seed.owner()
  const actor: Actor.Info = { userId: seeded.createdBy, organizationId: seeded.organizationId, roles: ["owner"] }
  return { ...seeded, actor }
})

export const post = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
  method = "POST",
): Effect.Effect<Intake.Reply, never, Intake.Service> =>
  Effect.flatMap(Intake.Service, (intake) => {
    const parsed = new URL(url)
    return intake.receive("webhook", {
      method,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      headers: new Headers({ "content-type": "application/json", ...headers }),
      body,
    })
  })
