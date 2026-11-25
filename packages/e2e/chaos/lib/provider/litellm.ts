export * as LiteLLM from "./litellm.js"

import { Schema } from "effect"
import { Models } from "@ren/schema/models"

const Generated = Schema.Struct({ key: Schema.String })

export const url = (process.env.CHAOS_LITELLM_ADMIN_URL ?? "").replace(/\/$/, "")

const Listed = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

// oxlint-disable-next-line ren/no-comments -- The models an inference key may call, as one Ren endpoint: the inference service's OpenAI-compatible model list.
export const listed = async (baseUrl: string, key: string): Promise<Models.Catalog> => {
  const root = baseUrl.replace(/\/v1\/?$/u, "").replace(/\/$/u, "")
  const response = await fetch(`${root}/v1/models`, { headers: { authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`The inference service's model list answered ${response.status}`)
  const found = Schema.decodeUnknownSync(Listed)(await response.json())
  return {
    endpoints: [
      {
        id: "ren",
        name: "Ren",
        protocol: "openai-chat",
        baseUrl: `${root}/v1`,
        models: found.data.map((model) => ({ id: model.id, type: "chat" as const, protocol: "openai-chat" as const })),
      },
    ],
  }
}

export const catalog = (key: string) => listed(process.env.CHAOS_INFERENCE_URL ?? "", key)

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
  const team = process.env.CHAOS_LITELLM_TEAM
  const response = await call("POST", "/key/generate", { ...options, ...(team && { team_id: team }) })
  if (!response.ok) throw new Error(`LiteLLM key generation answered ${response.status}`)
  return Schema.decodeUnknownSync(Schema.fromJsonString(Generated))(await response.text()).key
}

export const remove = async (key: string) => (await call("POST", "/key/delete", { keys: [key] })).status

export const exists = async (key: string) => (await call("GET", `/key/info?key=${encodeURIComponent(key)}`)).ok

export const allow = async (key: string, models: ReadonlyArray<string>) => {
  const response = await call("POST", "/key/update", { key, models })
  if (!response.ok) throw new Error(`LiteLLM key update answered ${response.status}`)
}
