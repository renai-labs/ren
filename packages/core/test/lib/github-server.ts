export * as GitHubServer from "./github-server.js"

import { generateKeyPairSync, verify } from "node:crypto"
import { Schema } from "effect"

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })

export const privateKey = keys.privateKey.export({ type: "pkcs1", format: "pem" })

export const appId = "424242"

export const config = (url: string, overrides: Record<string, string> = {}) => ({
  GITHUB_APP_ID: appId,
  GITHUB_APP_SLUG: "ren-test",
  GITHUB_APP_BOT_USER_ID: "9001",
  GITHUB_APP_PRIVATE_KEY: privateKey,
  GITHUB_APP_CLIENT_ID: "Iv1.test",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  GITHUB_API_URL: url,
  GITHUB_URL: url,
  ...overrides,
})

const Claims = Schema.fromJsonString(Schema.Struct({ iat: Schema.Number, exp: Schema.Number, iss: Schema.String }))

const Exchange = Schema.fromJsonString(
  Schema.Struct({ client_id: Schema.String, client_secret: Schema.String, code: Schema.String }),
)

export const claimsOf = (jwt: string) =>
  Schema.decodeUnknownSync(Claims)(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"))

const signedByApp = (authorization: string | null) => {
  const jwt = authorization?.replace(/^Bearer /u, "") ?? ""
  const parts = jwt.split(".")
  if (parts.length !== 3) return false
  const valid = verify(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    keys.publicKey,
    Buffer.from(parts[2] ?? "", "base64url"),
  )
  const claims = claimsOf(jwt)
  return valid && claims.iss === appId && claims.exp - claims.iat <= 600
}

export interface Instance {
  readonly url: string
  readonly installations: Map<string, string>
  readonly users: Map<string, ReadonlyArray<string>>
  readonly deleted: Array<string>
  readonly minted: Array<string>
  readonly resources: Map<string, unknown>
  readonly posted: Array<{ readonly path: string; readonly body: unknown; readonly authorization: string | null }>
  readonly removed: Array<string>
  readonly options: { failDelete: boolean; tokenExpiresAt: string; postStatus: number }
  readonly stop: () => void
}

type State = Omit<Instance, "url" | "stop">

const exchange = async (state: State, request: Request) => {
  const body = Schema.decodeUnknownSync(Exchange)(await request.text())
  const answer =
    state.users.has(body.code) && body.client_secret === "client-secret"
      ? {
          access_token: `user:${body.code}`,
          token_type: "bearer",
          refresh_token: `refresh:${body.code}`,
          expires_in: 28800,
        }
      : { error: "bad_verification_code" }
  return request.headers.get("accept") === "application/json"
    ? Response.json(answer)
    : new Response(
        new URLSearchParams(
          Object.fromEntries(Object.entries(answer).map(([key, value]) => [key, String(value)])),
        ).toString(),
        {
          headers: { "content-type": "application/x-www-form-urlencoded" },
        },
      )
}

const userOf = (state: State, request: Request) => {
  const code = request.headers.get("authorization")?.replace(/^Bearer user:/u, "") ?? ""
  if (!state.users.has(code)) return new Response(null, { status: 401 })
  return Response.json({ id: 7000 + code.length, login: `person-${code.slice(-6)}`, name: null })
}

const userInstallations = (state: State, request: Request, url: URL) => {
  const reachable = state.users.get(request.headers.get("authorization")?.replace(/^Bearer user:/u, "") ?? "")
  if (!reachable) return new Response(null, { status: 401 })
  const page = Number(url.searchParams.get("page") ?? "1")
  const perPage = Number(url.searchParams.get("per_page") ?? "30")
  return Response.json({
    total_count: reachable.length,
    installations: reachable.slice((page - 1) * perPage, page * perPage).map((id) => ({ id: Number(id) })),
  })
}

const appInstallation = (state: State, request: Request, id: string, options: { readonly tokens: boolean }) => {
  if (!signedByApp(request.headers.get("authorization"))) return new Response(null, { status: 401 })
  const login = state.installations.get(id)
  if (!login) return new Response(null, { status: 404 })
  if (options.tokens) {
    state.minted.push(id)
    return Response.json(
      { token: `ghs_${id}_${state.minted.length}`, expires_at: state.options.tokenExpiresAt },
      { status: 201 },
    )
  }
  if (request.method !== "DELETE") return Response.json({ id: Number(id), account: { login, type: "Organization" } })
  if (state.options.failDelete) return new Response("down", { status: 502 })
  state.installations.delete(id)
  state.deleted.push(id)
  return new Response(null, { status: 204 })
}

const resource = (state: State, request: Request, url: URL) => {
  if (!request.headers.get("authorization")?.startsWith("Bearer ghs_")) return new Response(null, { status: 401 })
  const found = state.resources.get(url.pathname)
  return found === undefined ? new Response(null, { status: 404 }) : Response.json(found)
}

const post = async (state: State, request: Request, url: URL) => {
  const authorization = request.headers.get("authorization")
  state.posted.push({ path: url.pathname, body: await request.json(), authorization })
  return state.options.postStatus < 300
    ? Response.json({ id: state.posted.length }, { status: state.options.postStatus })
    : Response.json({ message: "Not Found" }, { status: state.options.postStatus })
}

const api = (state: State, request: Request, url: URL) => {
  if (request.method === "POST") return post(state, request, url)
  if (request.method !== "DELETE") return resource(state, request, url)
  state.removed.push(url.pathname)
  return new Response(null, { status: 204 })
}

export const start = (): Instance => {
  const state: State = {
    installations: new Map(),
    users: new Map(),
    deleted: [],
    minted: [],
    resources: new Map(),
    posted: [],
    removed: [],
    options: { failDelete: false, tokenExpiresAt: "2027-01-15T08:00:00Z", postStatus: 201 },
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname === "/login/oauth/access_token") return exchange(state, request)
      if (request.method === "GET" && url.pathname === "/user") return userOf(state, request)
      if (request.method === "GET" && url.pathname === "/user/installations")
        return userInstallations(state, request, url)
      if (url.pathname.startsWith("/repos/") || url.pathname.startsWith("/users/")) return api(state, request, url)
      const match = /^\/app\/installations\/(\d+)(\/access_tokens)?$/u.exec(url.pathname)
      if (!match?.[1]) return new Response(null, { status: 404 })
      return appInstallation(state, request, match[1], { tokens: request.method === "POST" && Boolean(match[2]) })
    },
  })
  return { ...state, url: server.url.origin, stop: () => void server.stop(true) }
}
