export * as TestToken from "./token.js"

import { Base64Url } from "effect/encoding"

const encoder = new TextEncoder()

export const keys = [
  { id: "active", secret: "active-secret-of-at-least-32-chars" },
  { id: "retiring", secret: "retiring-secret-of-at-least-32-chars" },
] as const

export const vars = { CELL_KEYS: JSON.stringify(keys) }

export const sign = async (secret: string, payload: unknown) => {
  const signed = Base64Url.encode(JSON.stringify(payload))
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
  return `${signed}.${Base64Url.encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signed))))}`
}

export const basic = (token: string, user = "opencode") => `Basic ${btoa(`${user}:${token}`)}`
