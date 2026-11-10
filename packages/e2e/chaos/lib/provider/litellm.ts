export * as LiteLLM from "./litellm.js"

import { Schema } from "effect"
import { RenInferenceProvider } from "@ren/core/ren-inference/provider"
import { Models } from "@ren/schema/models"

const Generated = Schema.Struct({ key: Schema.String })

export const url = (process.env.CHAOS_LITELLM_ADMIN_URL ?? "").replace(/\/$/, "")

export const catalog = async (key: string): Promise<Models.Catalog> => {
  const response = await fetch(`${process.env.CHAOS_INFERENCE_URL?.replace(/\/$/u, "")}/v1/catalog`, {
    headers: { authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`Inference discovery answered ${response.status}`)
  return {
    endpoints: [
      RenInferenceProvider.endpoint(Schema.decodeUnknownSync(Models.InferenceCatalog)(await response.json())),
    ],
  } satisfies Models.Catalog
}

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
