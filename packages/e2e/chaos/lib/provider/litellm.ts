export * as LiteLLM from "./litellm.js"

import { Schema } from "effect"

const Generated = Schema.Struct({ key: Schema.String })

export const url = (process.env.CHAOS_LITELLM_ADMIN_URL ?? "").replace(/\/$/, "")

const call = (method: string, route: string, body?: unknown) =>
  fetch(`${url}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.CHAOS_LITELLM_ADMIN_KEY ?? ""}`,
      "content-type": "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

export const generate = async (options: { readonly duration: string; readonly models: ReadonlyArray<string> }) => {
  const response = await call("POST", "/key/generate", options)
  if (!response.ok) throw new Error(`LiteLLM key generation answered ${response.status}`)
  return Schema.decodeUnknownSync(Schema.fromJsonString(Generated))(await response.text()).key
}

export const remove = async (key: string) => (await call("POST", "/key/delete", { keys: [key] })).status

export const exists = async (key: string) => (await call("GET", `/key/info?key=${encodeURIComponent(key)}`)).ok
