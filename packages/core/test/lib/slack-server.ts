export * as SlackServer from "./slack-server.js"

import { createHmac } from "node:crypto"

const signingSecret = "slack-signing"

export const config = (url: string, overrides: Record<string, string> = {}) => ({
  SLACK_CLIENT_ID: "slack-client",
  SLACK_CLIENT_SECRET: "slack-secret",
  SLACK_SIGNING_SECRET: signingSecret,
  SLACK_API_URL: `${url}/api`,
  SLACK_URL: url,
  REN_URL: "https://api.ren.test",
  ...overrides,
})

export const sign = (body: string, timestamp: number) => ({
  "x-slack-request-timestamp": String(timestamp),
  "x-slack-signature": `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
})

export interface Grant {
  readonly team: string
  readonly teamName: string
  readonly user: string
  readonly token: string
}

interface Channel {
  readonly id: string
  readonly name: string
  readonly is_private: boolean
}

export interface Instance {
  readonly url: string
  readonly grants: Map<string, Grant>
  readonly revoked: Array<string>
  readonly channels: Array<Channel>
  readonly posted: Array<{ readonly method: string; readonly token: string; readonly params: Params }>
  readonly options: { pageSize: number; revokeError: string | undefined; postError: string | undefined }
  readonly stop: () => void
}

type State = Omit<Instance, "url" | "stop">

type Params = Partial<Record<string, string>>

const answer = (body: object) => Response.json({ ok: true, ...body })

const refuse = (error: string) => Response.json({ ok: false, error })

const tokenOf = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""

const known = (state: State, token: string) => [...state.grants.values()].some((grant) => grant.token === token)

const exchange = (state: State, params: Params) => {
  const grant = state.grants.get(params.code ?? "")
  if (!grant || params.client_secret !== "slack-secret") return refuse("invalid_code")
  return answer({
    access_token: grant.token,
    token_type: "bot",
    scope: "chat:write",
    bot_user_id: "UBOT",
    team: { id: grant.team, name: grant.teamName },
    authed_user: { id: grant.user },
  })
}

const conversations = (state: State, params: Params) => {
  const start = Number(params.cursor ?? "0")
  const next = start + state.options.pageSize
  return answer({
    channels: state.channels.slice(start, next),
    response_metadata: { next_cursor: next < state.channels.length ? String(next) : "" },
  })
}

const method = (state: State, name: string, token: string, params: Params) => {
  if (name === "oauth.v2.access") return exchange(state, params)
  if (!known(state, token)) return refuse("invalid_auth")
  switch (name) {
    case "auth.revoke":
      if (state.options.revokeError) return refuse(state.options.revokeError)
      state.revoked.push(token)
      return answer({ revoked: true })
    case "conversations.list":
      return conversations(state, params)
    case "conversations.info": {
      const found = state.channels.find((channel) => channel.id === params.channel)
      return found ? answer({ channel: found }) : refuse("channel_not_found")
    }
    default:
      state.posted.push({ method: name, token, params })
      return state.options.postError ? refuse(state.options.postError) : answer({ ts: `${state.posted.length}.0` })
  }
}

export const start = (): Instance => {
  const state: State = {
    grants: new Map(),
    revoked: [],
    channels: [],
    posted: [],
    options: { pageSize: 200, revokeError: undefined, postError: undefined },
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const name = /^\/api\/([\w.]+)$/u.exec(url.pathname)?.[1]
      if (request.method !== "POST" || !name) return new Response(null, { status: 404 })
      const params = Object.fromEntries(new URLSearchParams(await request.text()))
      return method(state, name, tokenOf(request), params)
    },
  })
  return { ...state, url: server.url.origin, stop: () => void server.stop(true) }
}
