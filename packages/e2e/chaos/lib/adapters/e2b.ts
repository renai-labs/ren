export * as E2BHand from "./e2b.js"

import type { Hand } from "@ren/schema/hand"
import { Schema } from "effect"
import { ExecutorAdapter } from "./executor.js"
import { Process } from "../process.js"
import { Wait } from "../wait.js"

const executorPort = 4100

const api = () => process.env.CHAOS_E2B_API ?? "https://api.e2b.dev"

const domain = () => process.env.CHAOS_E2B_DOMAIN ?? "e2b.app"

const Created = Schema.Struct({
  sandboxID: Schema.String,
  envdAccessToken: Schema.optional(Schema.NullOr(Schema.String)),
})

const envdPort = 49983

const Listed = Schema.Array(
  Schema.Struct({
    sandboxID: Schema.String,
    state: Schema.optional(Schema.String),
  }),
)

const call = async (operation: string, method: string, route: string, body?: unknown) => {
  const response = await fetch(`${api()}${route}`, {
    method,
    headers: { "x-api-key": process.env.E2B_API_KEY ?? "", "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`E2B ${operation} answered ${response.status}: ${text.slice(0, 500)}`)
  return text
}

export interface Sandbox {
  readonly id: string
  readonly handId: Hand.ID
  readonly url: string
  readonly pause: () => Promise<void>
  readonly resume: (timeoutSeconds?: number) => Promise<void>
  readonly extend: (timeoutSeconds: number) => Promise<void>
  readonly kill: () => Promise<void>
  readonly state: () => Promise<string | undefined>
}

const endpoint = (sandboxId: string, port = executorPort) => `https://${port}-${sandboxId}.${domain()}`

const configure = async (
  sandboxId: string,
  accessToken: string | null | undefined,
  variables: Readonly<Record<string, string>>,
) => {
  const form = new FormData()
  const content = Object.entries(variables)
    .map((entry) => `${entry[0]}='${entry[1]}'`)
    .join("\n")
  form.append("file", new Blob([`${content}\n`]), "executor.env")
  const response = await fetch(
    `${endpoint(sandboxId, envdPort)}/files?path=${encodeURIComponent("/run/ren/executor.env")}`,
    {
      method: "POST",
      headers: accessToken ? { "x-access-token": accessToken } : {},
      body: form,
    },
  )
  if (!response.ok) throw new Error(`E2B configure answered ${response.status}: ${await response.text()}`)
}

export const create = async (options: {
  readonly handId: Hand.ID
  readonly timeoutSeconds?: number
}): Promise<Sandbox> => {
  const template = process.env.CHAOS_E2B_TEMPLATE ?? ""
  const created = Schema.decodeUnknownSync(Schema.fromJsonString(Created))(
    await call("create", "POST", "/sandboxes", {
      templateID: template,
      timeout: options.timeoutSeconds ?? 300,
      metadata: { "ren-hand": options.handId },
    }),
  )
  const id = created.sandboxID
  const remove = () => call("kill", "DELETE", `/sandboxes/${id}`)
  const forget = Process.onInterrupt(remove)
  await configure(created.sandboxID, created.envdAccessToken, {
    EXECUTOR_HAND_ID: options.handId,
    HAND_PUBLIC_KEYS: ExecutorAdapter.publicKeys,
    PORT: String(executorPort),
  })
  return {
    id,
    handId: options.handId,
    url: endpoint(id),
    pause: async () => {
      await call("pause", "POST", `/sandboxes/${id}/pause`)
    },
    resume: async (timeoutSeconds = 300) => {
      await call("resume", "POST", `/sandboxes/${id}/resume`, { timeout: timeoutSeconds })
    },
    extend: async (timeoutSeconds) => {
      await call("timeout", "POST", `/sandboxes/${id}/timeout`, { timeout: timeoutSeconds })
    },
    kill: async () => {
      forget()
      await remove()
    },
    state: async () => (await list()).find((sandbox) => sandbox.sandboxID === id)?.state,
  }
}

const list = async () =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Listed))(
    await call("list", "GET", "/v2/sandboxes?state=running,paused"),
  )

export const ready = (url: string, ms = 120_000) =>
  Wait.until(`E2B executor at ${url}`, ms, async () => {
    const response = await fetch(`${url}/v1/rpc`, { method: "POST", signal: AbortSignal.timeout(2_000) }).catch(
      () => undefined,
    )
    return response?.status === 401 ? true : undefined
  })
