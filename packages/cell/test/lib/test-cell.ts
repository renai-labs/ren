export * as TestCell from "./test-cell.js"

import { OpenCode } from "@opencode/client"
import { BrainApi, hostTokenHeader } from "@ren/host-api/brain-api"
import { Brain } from "@ren/schema/brain"
import { DateTime, Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { FakeRen } from "./ren.js"
import { Shared } from "./shared.js"
import { TestToken } from "./token.js"

interface State {
  readonly isOpen: boolean
  readonly holders: number
  readonly waitingSince: number | null
  readonly nextReconcileAt: number | null
}

export const idleOf = (kind: Shared.Runtime["kind"]): State =>
  kind === "bun"
    ? { isOpen: true, holders: 1, waitingSince: null, nextReconcileAt: null }
    : { isOpen: false, holders: 0, waitingSince: null, nextReconcileAt: null }

export const idle = idleOf(Shared.kind())

export interface Target {
  readonly kind: Shared.Runtime["kind"]
  readonly url: string
  readonly ren: FakeRen.Instance
  readonly brain: () => Brain.ID
}

export const make = async (target: Target) => {
  const url = target.url
  const brain = target.brain()
  const id = `ses_${crypto.randomUUID().replaceAll("-", "")}`
  const client = await TestToken.sign({
    scope: "client",
    brain,
    gen: 1,
    sid: Session.ID.make(id),
    sub: "user_1",
    exp: TestToken.exp(),
  })
  const server = TestToken.basic(await TestToken.sign({ scope: "server", brain, gen: 1, exp: TestToken.exp() }))
  const opencode = OpenCode.make({ baseUrl: url, headers: { authorization: server } })
  const greeted = await fetch(`${url}/ren/state`, {
    headers: { authorization: server, [hostTokenHeader]: await FakeRen.hostToken(brain) },
  })
  if (greeted.status !== 200) throw new Error(`/ren/state answered ${greeted.status}: ${await greeted.text()}`)
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
  const settled = async (timeout = 60_000): Promise<State> => {
    const reached = await until((current) => Bun.deepEquals(current, idleOf(target.kind)), timeout)
    if (target.kind !== "bun" || Object.keys(await opencode.session.active()).length === 0) return reached
    if (timeout <= 0) throw new Error("a turn never ended")
    await Bun.sleep(25)
    return settled(timeout - 25)
  }
  const prompt = (text: string, input: { readonly delivery?: "queue" } = {}) =>
    opencode.session.prompt({ sessionID: id, text, ...input })
  return {
    id,
    idle: idleOf(target.kind),
    brainId: brain,
    client,
    brain: (path: string, body: unknown, authorization = server) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    models: async (access: Models.Access = Shared.access(), hostToken?: string) => {
      target.ren.models(access, brain)
      return fetch(`${url}/ren/wake`, {
        method: "POST",
        headers: {
          authorization: server,
          [hostTokenHeader]: hostToken ?? (await FakeRen.hostToken(brain)),
        },
      })
    },
    removeModels: () => {
      target.ren.models({ endpoints: [] }, brain)
      return fetch(`${url}/ren/wake`, { method: "POST", headers: { authorization: server } })
    },
    server,
    opencode,
    state,
    until,
    settled,
    prompt,
    request: (path: string, init: { readonly method?: string; readonly body?: string } = {}, authorization = server) =>
      fetch(`${url}${path}`, {
        ...init,
        headers: { authorization, "content-type": "application/json" },
      }),
    start: async () => {
      const response = await fetch(`${url}/ren/sessions`, {
        method: "POST",
        headers: { authorization: server, "content-type": "application/json" },
        body: JSON.stringify({ sessionId: id, harness: "opencode", interactive: true }),
      })
      if (response.status !== 200) throw new Error(`start answered ${response.status}: ${await response.text()}`)
    },
    messages: async () => (await opencode.message.list({ sessionID: id, order: "asc" })).data,
    stream: async () => {
      const controller = new AbortController()
      const response = await fetch(`${url}/chat/event`, {
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
