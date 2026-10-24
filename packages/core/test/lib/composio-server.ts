export * as ComposioServer from "./composio-server.js"

// oxlint-disable-next-line ren/no-comments -- A local Composio REST v3.1 server at the wire level (connections.md §15; prior art ren-v1 `test/fixture/composio-server.ts`). Each test sets account states and failures and reads what Ren sent.
import { Option, Schema } from "effect"

const Body = Schema.Struct({
  toolkit: Schema.optional(Schema.Struct({ slug: Schema.String })),
  auth_config_id: Schema.optional(Schema.String),
  user_id: Schema.optional(Schema.String),
  callback_url: Schema.optional(Schema.String),
})
const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Body))
const decodeRaw = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export interface Request {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly apiKey: string | null
  readonly body: typeof Body.Type
  readonly raw: unknown
}

export interface State {
  authConfigs: Array<{ id: string; toolkit: string; managed: boolean }>
  accounts: Map<string, { status: string; userId: string; authConfigId: string }>
  sessions: Map<string, { userId: string; body: unknown }>
  activeAfterReads: number
  failDeletes: boolean
  readonly requests: Array<Request>
  readonly after: (count: number) => Promise<void>
}

export interface Instance extends State {
  readonly url: string
  readonly stop: () => void
}

let counter = 0
const next = (prefix: string) => `${prefix}_${++counter}`

type Handler = (state: State, request: Request, url: URL) => Response | null

const authConfigs: Handler = (state, request) => {
  if (request.path !== "/api/v3.1/auth_configs") return null
  if (request.method === "GET") {
    const toolkit = request.query.get("toolkit_slug")
    return Response.json({
      items: state.authConfigs
        .filter((config) => config.toolkit === toolkit && config.managed)
        .map((config) => ({
          id: config.id,
          toolkit: { slug: config.toolkit },
          is_composio_managed: true,
          status: "ENABLED",
        })),
    })
  }
  const id = next("ac")
  state.authConfigs.push({ id, toolkit: request.body.toolkit?.slug ?? "", managed: true })
  return Response.json(
    { toolkit: request.body.toolkit, auth_config: { id, is_composio_managed: true } },
    { status: 201 },
  )
}

const link: Handler = (state, request) => {
  if (request.path !== "/api/v3.1/connected_accounts/link") return null
  const id = next("ca")
  state.accounts.set(id, {
    status: "INITIATED",
    userId: request.body.user_id ?? "",
    authConfigId: request.body.auth_config_id ?? "",
  })
  return Response.json(
    {
      link_token: "lt",
      redirect_url: `https://connect.composio.test/link/${id}`,
      connected_account_id: id,
      expires_at: "",
    },
    { status: 201 },
  )
}

const account: Handler = (state, request) => {
  const id = /^\/api\/v3\.1\/connected_accounts\/([^/]+)$/u.exec(request.path)?.at(1)
  if (!id) return null
  const found = state.accounts.get(id)
  if (request.method === "DELETE") {
    if (state.failDeletes) return Response.json({ error: { message: "down" } }, { status: 503 })
    state.accounts.delete(id)
    return Response.json({ success: true })
  }
  if (!found) return Response.json({ error: { message: "not found" } }, { status: 404 })
  if (found.status === "INITIATED" && state.activeAfterReads > 0 && --state.activeAfterReads === 0)
    found.status = "ACTIVE"
  return Response.json({ id, status: found.status, toolkit: { slug: "gmail" } })
}

const session: Handler = (state, request, url) => {
  if (request.path === "/api/v3.1/tool_router/session" && request.method === "POST") {
    const id = next("trs")
    state.sessions.set(id, { userId: request.body.user_id ?? "", body: request.raw })
    return Response.json(
      {
        session_id: id,
        mcp: { type: "http", url: `${url.origin}/tool_router/${id}/mcp` },
        tool_router_tools: [],
        config: {},
      },
      { status: 201 },
    )
  }
  const id = /^\/api\/v3\.1\/tool_router\/session\/([^/]+)$/u.exec(request.path)?.at(1)
  if (!id || request.method !== "DELETE") return null
  if (state.failDeletes) return Response.json({ error: { message: "down" } }, { status: 503 })
  state.sessions.delete(id)
  return Response.json({ session_id: id, deleted: true })
}

const handlers = [authConfigs, link, account, session]

export const start = (): Instance => {
  const waiting: Array<() => void> = []
  const state: State = {
    after: (count) =>
      new Promise((resolve) => {
        const check = () => (state.requests.length > count ? resolve() : waiting.push(check))
        check()
      }),
    authConfigs: [],
    accounts: new Map(),
    sessions: new Map(),
    activeAfterReads: 1,
    failDeletes: false,
    requests: [],
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (raw) => {
      const url = new URL(raw.url)
      const text = raw.method === "GET" || raw.method === "DELETE" ? "" : await raw.text()
      const request: Request = {
        method: raw.method,
        path: url.pathname,
        query: url.searchParams,
        apiKey: raw.headers.get("x-api-key"),
        body: Option.getOrElse(decodeBody(text), () => ({})),
        raw: Option.getOrUndefined(decodeRaw(text)),
      }
      state.requests.push(request)
      for (const check of waiting.splice(0)) check()
      if (request.apiKey !== "composio-test-key")
        return Response.json({ error: { message: "no key" } }, { status: 401 })
      return (
        handlers.map((handler) => handler(state, request, url)).find((response) => response !== null) ??
        new Response("not found", { status: 404 })
      )
    },
  })
  return Object.assign(state, { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) })
}
