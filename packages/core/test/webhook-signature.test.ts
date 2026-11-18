import { describe, expect } from "bun:test"
import type { Webhook } from "@ren/schema/webhook"
import { Effect, Layer, Option } from "effect"
import { WebhookSignature } from "../src/webhook-signature.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Layer.empty)

describe("WebhookSignature", () => {
  it.live("Stripe and Standard Webhooks signatures are checked against Ren's clock, with a 5-minute window", () =>
    Effect.gen(function* () {
      const body = '{"id":"evt_1"}'
      const now = 1_794_049_134_000
      const stripeSecret = "whsec_stripe_test"
      const t = now / 1000
      const stripe = `t=${t},v1=${WebhookSignature.hmac(stripeSecret, `${t}.${body}`, "hex")}`
      const check = (signature: Webhook.Signature, secret: string, headers: Record<string, string>, at: number) =>
        WebhookSignature.verify(signature, Option.some(secret), { headers, body }, at)
      expect(yield* check({ kind: "stripe" }, stripeSecret, { "stripe-signature": stripe }, now)).toEqual({
        _tag: "Verified",
      })
      expect(yield* check({ kind: "stripe" }, stripeSecret, { "stripe-signature": stripe }, now + 301_000)).toEqual({
        _tag: "Rejected",
        reason: "the request is older than 5 minutes",
      })
      const key = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")
      const sent = Date.now()
      const at = Math.floor(sent / 1000)
      const standard = `v1,${WebhookSignature.hmac(Buffer.from(key, "base64"), `msg_1.${at}.${body}`, "base64")}`
      const headers = { "webhook-id": "msg_1", "webhook-timestamp": String(at), "webhook-signature": standard }
      expect(yield* check({ kind: "standard" }, `whsec_${key}`, headers, sent)).toEqual({ _tag: "Verified" })
      expect(yield* check({ kind: "standard" }, `whsec_${key}`, headers, sent + 301_000)).toEqual({
        _tag: "Rejected",
        reason: "the request is older than 5 minutes",
      })
    }),
  )
})
