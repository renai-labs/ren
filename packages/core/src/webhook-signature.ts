export * as WebhookSignature from "./webhook-signature.js"

import type { Webhook as WebhookSchema } from "@ren/schema/webhook"
import { Effect, Option } from "effect"
import { timingSafeEqual } from "node:crypto"
import { Webhook } from "standardwebhooks"
import Stripe from "stripe"

export const toleranceSeconds = 5 * 60

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

const tooOld = rejected("the request is older than 5 minutes")

export const same = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const hmac = (key: string | Uint8Array, text: string, encoding: "hex" | "base64") =>
  new Bun.CryptoHasher("sha256", key).update(text).digest(encoding)

const standard = (secret: string, request: Request, now: number) => {
  const sent = Number(request.headers["webhook-timestamp"]) * 1000
  if (!Number.isFinite(sent) || Math.abs(now - sent) > toleranceSeconds * 1000) return Effect.succeed(tooOld)
  return Effect.try(() => new Webhook(secret).verify(request.body, request.headers)).pipe(
    Effect.as(verified),
    Effect.orElseSucceed(() => rejected("wrong signature")),
  )
}

const stripe = (secret: string, request: Request, now: number) =>
  Effect.tryPromise(() =>
    Stripe.webhooks.constructEventAsync(
      request.body,
      request.headers["stripe-signature"] ?? "",
      secret,
      toleranceSeconds,
      undefined,
      now,
    ),
  ).pipe(
    Effect.as(verified),
    Effect.catch((error) =>
      Effect.succeed(String(error.cause).includes("tolerance") ? tooOld : rejected("wrong signature")),
    ),
  )

export const verify = (
  signature: WebhookSchema.Signature,
  secret: Option.Option<string>,
  request: Request,
  now: number,
): Effect.Effect<Checked> => {
  if (signature.kind === "none") return Effect.succeed(verified)
  if (Option.isNone(secret)) return Effect.succeed({ _tag: "Unsigned" })
  if (signature.kind === "standard") return standard(secret.value, request, now)
  if (signature.kind === "stripe") return stripe(secret.value, request, now)
  const value = request.headers[signature.header]
  if (!value) return Effect.succeed(rejected(`missing ${signature.header}`))
  if (signature.kind === "header")
    return Effect.succeed(same(value, secret.value) ? verified : rejected("wrong signature"))
  const prefix = signature.prefix ?? ""
  return Effect.succeed(
    value.startsWith(prefix) && same(value.slice(prefix.length), hmac(secret.value, request.body, signature.encoding))
      ? verified
      : rejected("wrong signature"),
  )
}

export const hidden = (signature: WebhookSchema.Signature): ReadonlySet<string> =>
  new Set([
    "authorization",
    "cookie",
    ...(signature.kind === "header" || signature.kind === "hmac" ? [signature.header] : []),
    ...(signature.kind === "standard" ? ["webhook-signature"] : []),
    ...(signature.kind === "stripe" ? ["stripe-signature"] : []),
  ])
