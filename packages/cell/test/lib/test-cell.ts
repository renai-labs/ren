export * as TestCell from "./test-cell.js"

import { OpenCode } from "@opencode/client"
import { BrainApi, ModelsBody } from "@ren/brain-api/brain-api"
import { DateTime, Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import type { Models } from "@ren/schema/models"
import { Shared } from "./shared.js"
import { TestToken } from "./token.js"

interface State {
  readonly isOpen: boolean
  readonly holders: number
  readonly waitingSince: number | null
  readonly nextReconcileAt: number | null
}

export const closed: State = { isOpen: false, holders: 0, waitingSince: null, nextReconcileAt: null }

export const sign = (payload: Record<string, unknown>, secret: string = TestToken.keys[0].secret) =>
  TestToken.sign(secret, { kid: "active", scope: "client", exp: Math.floor(Date.now() / 1000) + 600, ...payload })

export const make = async (url: string) => {
  const id = `ses_${crypto.randomUUID().replaceAll("-", "")}`
  const client = await sign({ sid: id })
  const server = TestToken.basic(await sign({ sid: id, scope: "server" }))
  const opencode = OpenCode.make({ baseUrl: url, headers: { authorization: TestToken.basic(client) } })
  const state = (): Promise<State> =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const brain = yield* HttpApiClient.makeWith(BrainApi, {
        baseUrl: url,
        httpClient: HttpClient.mapRequest(http, HttpClientRequest.setHeader("authorization", server)),
      })
      const read = yield* brain.brain["brain.state"]()
      return {
        isOpen: read.isOpen,
        holders: read.holders,
        waitingSince: read.waitingSince && DateTime.toEpochMillis(read.waitingSince),
        nextReconcileAt: read.nextReconcileAt && DateTime.toEpochMillis(read.nextReconcileAt),
      }
    }).pipe(Effect.provide(FetchHttpClient.layer), Effect.runPromise)
  const until = async (predicate: (state: State) => boolean, timeout = 20_000): Promise<State> => {
    const current = await state()
    if (predicate(current)) return current
    if (timeout <= 0) throw new Error(`/ren/state never matched; last ${JSON.stringify(current)}`)
    await Bun.sleep(25)
    return until(predicate, timeout - 25)
  }
  const prompt = (text: string, input: { readonly delivery?: "queue" } = {}) =>
    opencode.session.prompt({ sessionID: id, text, ...input })
  return {
    id,
    client,
    brain: (path: string, body: unknown, authorization = server) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    models: (access: Models.Access = Shared.access()) =>
      fetch(`${url}/ren/models`, {
        method: "PUT",
        headers: { authorization: server, "content-type": "application/json" },
        body: JSON.stringify(Schema.encodeSync(ModelsBody)({ access })),
      }),
    removeModels: () => fetch(`${url}/ren/models`, { method: "DELETE", headers: { authorization: server } }),
    server,
    opencode,
    state,
    until,
    prompt,
    request: (path: string, init: { readonly method?: string; readonly body?: string } = {}) =>
      fetch(`${url}${path}`, {
        ...init,
        headers: { authorization: TestToken.basic(client), "content-type": "application/json" },
      }),
    start: async () => {
      await opencode.session.create({ id })
    },
    messages: async () => (await opencode.message.list({ sessionID: id, order: "asc" })).data,
    stream: async () => {
      const controller = new AbortController()
      const response = await fetch(`${url}/api/event`, {
        headers: { authorization: TestToken.basic(client) },
        signal: controller.signal,
      })
      const reader = response.body?.getReader()
      if (!reader) throw new Error("the event stream has no body")
      await reader.read()
      return { close: () => controller.abort() }
    },
  }
}

export const kinds = (messages: ReadonlyArray<{ readonly type: string; readonly outcome?: string }>) =>
  messages.map((message) => (message.type === "idle" ? `idle:${message.outcome}` : message.type))
