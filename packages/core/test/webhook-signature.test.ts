import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { WebhookSignature } from "../src/webhook-signature.js"

const github = { kind: "hmac", header: "x-hub-signature-256", prefix: "sha256=", encoding: "hex" } as const

describe("WebhookSignature", () => {
  test("GitHub's documented example verifies, and another body with its signature is rejected", () => {
    const secret = Option.some("It's a Secret to Everybody")
    const headers = {
      "x-hub-signature-256": "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    }
    expect(WebhookSignature.verify(github, secret, { headers, body: "Hello, World!" }, Date.now())).toEqual({
      _tag: "Verified",
    })
    expect(WebhookSignature.verify(github, secret, { headers, body: "Hello, World?" }, Date.now())).toEqual({
      _tag: "Rejected",
      reason: "wrong signature",
    })
  })

  test("the Standard Webhooks example verifies at its time and is refused 6 minutes later", () => {
    const secret = Option.some("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw")
    const request = {
      headers: {
        "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
        "webhook-timestamp": "1614265330",
        "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
      },
      body: '{"test": 2432232314}',
    }
    const at = 1614265330 * 1000
    expect(WebhookSignature.verify({ kind: "standard" }, secret, request, at)).toEqual({ _tag: "Verified" })
    expect(WebhookSignature.verify({ kind: "standard" }, secret, request, at + 6 * 60 * 1000)).toEqual({
      _tag: "Rejected",
      reason: "the request is older than 5 minutes",
    })
  })

  test("a Stripe signature verifies with its secret only, and only within 5 minutes of its time", () => {
    const body = '{"type":"checkout.session.completed"}'
    const t = 1_762_000_000
    const v1 = WebhookSignature.hmac("whsec_test", `${t}.${body}`, "hex")
    const request = { headers: { "stripe-signature": `t=${t},v1=deadbeef,v1=${v1}` }, body }
    expect(WebhookSignature.verify({ kind: "stripe" }, Option.some("whsec_test"), request, t * 1000)).toEqual({
      _tag: "Verified",
    })
    expect(WebhookSignature.verify({ kind: "stripe" }, Option.some("whsec_other"), request, t * 1000)).toMatchObject({
      _tag: "Rejected",
    })
    expect(
      WebhookSignature.verify({ kind: "stripe" }, Option.some("whsec_test"), request, (t + 301) * 1000),
    ).toMatchObject({ _tag: "Rejected" })
  })

  test("a signature that needs a secret is unsigned before the secret is set; a header check compares the whole value", () => {
    const header = { kind: "header", header: "x-ren-secret" } as const
    const request = { headers: { "x-ren-secret": "s3cret" }, body: "{}" }
    expect(WebhookSignature.verify(header, Option.none(), request, 0)).toEqual({ _tag: "Unsigned" })
    expect(WebhookSignature.verify(header, Option.some("s3cret"), request, 0)).toEqual({ _tag: "Verified" })
    expect(WebhookSignature.verify(header, Option.some("s3cret!"), request, 0)).toMatchObject({ _tag: "Rejected" })
  })
})
