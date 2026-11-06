export * as WebhookSignature from "./webhook-signature.js"

import type { Webhook } from "@ren/schema/webhook"
import { Option, Schema } from "effect"
import { timingSafeEqual } from "node:crypto"

export const toleranceMillis = 5 * 60 * 1000

export interface Request {
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export type Checked =
  | { readonly _tag: "Verified" }
  | { readonly _tag: "Unsigned" }
  | { readonly _tag: "Rejected"; readonly reason: string }

const verified: Checked = { _tag: "Verified" }

const rejected = (reason: string): Checked => ({ _tag: "Rejected", reason })

const fromBase64 = Schema.decodeUnknownOption(Schema.Uint8ArrayFromBase64)

export const hmac = (key: string | Uint8Array, text: string, encoding: "hex" | "base64") =>
  new Bun.CryptoHasher("sha256", key).update(text).digest(encoding)

const same = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

const fresh = (seconds: string, now: number) => {
  const at = Number(seconds) * 1000
  return Number.isFinite(at) && Math.abs(now - at) <= toleranceMillis
}

// oxlint-disable-next-line ren/no-comments -- Standard Webhooks: the secret is `whsec_` and the base64 key; the signed text is `id.timestamp.body`; the header holds space-separated `v1,<base64>` values.
const standard = (secret: string, request: Request, now: number) => {
  const id = request.headers["webhook-id"]
  const timestamp = request.headers["webhook-timestamp"]
  const signatures = request.headers["webhook-signature"]
  if (!id || !timestamp || !signatures) return rejected("missing webhook-id, webhook-timestamp or webhook-signature")
  if (!fresh(timestamp, now)) return rejected("the request is older than 5 minutes")
  const key = Option.getOrElse(fromBase64(secret.replace(/^whsec_/u, "")), () => new TextEncoder().encode(secret))
  const expected = hmac(key, `${id}.${timestamp}.${request.body}`, "base64")
  return signatures.split(" ").some((each) => each.startsWith("v1,") && same(each.slice(3), expected))
    ? verified
    : rejected("wrong signature")
}

// oxlint-disable-next-line ren/no-comments -- Stripe: `stripe-signature: t=<seconds>,v1=<hex>,…`, the hex HMAC of `t.body` with the whole `whsec_…` secret.
const stripe = (secret: string, request: Request, now: number) => {
  const header = request.headers["stripe-signature"]
  if (!header) return rejected("missing stripe-signature")
  const parts = header.split(",").map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)])
  const timestamp = parts.find((part) => part.at(0) === "t")?.at(1)
  if (!timestamp || !fresh(timestamp, now)) return rejected("the request is older than 5 minutes")
  const expected = hmac(secret, `${timestamp}.${request.body}`, "hex")
  return parts.some((part) => part.at(0) === "v1" && same(part.at(1) ?? "", expected))
    ? verified
    : rejected("wrong signature")
}

// oxlint-disable-next-line ren/no-comments -- Spec section 4. A webhook with no signing secret yet is Unsigned: a listening webhook records the request with verified false (W20).
export const verify = (
  signature: Webhook.Signature,
  secret: Option.Option<string>,
  request: Request,
  now: number,
): Checked => {
  if (signature.kind === "none") return verified
  if (Option.isNone(secret)) return { _tag: "Unsigned" }
  if (signature.kind === "standard") return standard(secret.value, request, now)
  if (signature.kind === "stripe") return stripe(secret.value, request, now)
  const value = request.headers[signature.header]
  if (!value) return rejected(`missing ${signature.header}`)
  if (signature.kind === "header") return same(value, secret.value) ? verified : rejected("wrong signature")
  const prefix = signature.prefix ?? ""
  if (!value.startsWith(prefix)) return rejected("wrong signature")
  return same(value.slice(prefix.length), hmac(secret.value, request.body, signature.encoding))
    ? verified
    : rejected("wrong signature")
}

// oxlint-disable-next-line ren/no-comments -- W13: the headers that the model never sees.
export const hidden = (signature: Webhook.Signature) =>
  new Set([
    "authorization",
    "cookie",
    ...(signature.kind === "header" || signature.kind === "hmac" ? [signature.header] : []),
    ...(signature.kind === "standard" ? ["webhook-signature"] : []),
    ...(signature.kind === "stripe" ? ["stripe-signature"] : []),
  ])
