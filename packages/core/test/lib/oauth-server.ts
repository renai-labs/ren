export * as OAuthServer from "./oauth-server.js"

// oxlint-disable-next-line ren/no-comments -- A local MCP server and OAuth authorization server on 127.0.0.1 (connections.md §15). Each test sets what it answers and reads what Ren sent.
export interface Options {
  challenge?: { resourceMetadata?: boolean; scope?: string } | "none" | "open"
  resourceMetadata?: "path" | "root" | "none"
  resourceScopes?: ReadonlyArray<string>
  issuerPath?: string
  authorizationMetadata?: "oauth" | "openid" | "none"
  metadata?: Readonly<Record<string, unknown>>
  token?: (form: URLSearchParams) => { status: number; body: unknown }
}

export interface Seen {
  readonly path: string
  readonly form: URLSearchParams
  readonly authorization: string | null
}

export interface Instance {
  readonly origin: string
  readonly mcpUrl: string
  readonly issuer: string
  options: Options
  readonly seen: Array<Seen>
  readonly stop: () => void
}

export const bearer = (accessToken: string, extra: Readonly<Record<string, unknown>> = {}) => ({
  status: 200,
  body: { access_token: accessToken, token_type: "Bearer", ...extra },
})

type Route = (context: {
  readonly url: URL
  readonly options: Options
  readonly issuer: string
  readonly body: string
  readonly form: URLSearchParams
}) => Response | null

const mcp: Route = (context) => {
  if (context.url.pathname !== "/mcp") return null
  const challenge = context.options.challenge ?? {}
  if (challenge === "open") return Response.json({ jsonrpc: "2.0", id: 1, result: {} })
  if (challenge === "none") return new Response(null, { status: 401 })
  const parts = [
    ...(challenge.resourceMetadata === false
      ? []
      : [`resource_metadata="${context.url.origin}/.well-known/oauth-protected-resource/mcp"`]),
    ...(challenge.scope ? [`scope="${challenge.scope}"`] : []),
  ]
  return new Response(null, { status: 401, headers: { "www-authenticate": `Bearer ${parts.join(", ")}` } })
}

const resource: Route = (context) => {
  const kind = context.options.resourceMetadata ?? "path"
  const path = kind === "root" ? "/.well-known/oauth-protected-resource" : "/.well-known/oauth-protected-resource/mcp"
  if (kind === "none" || context.url.pathname !== path) return null
  return Response.json({
    resource: `${context.url.origin}/mcp`,
    authorization_servers: [context.issuer],
    ...(context.options.resourceScopes && { scopes_supported: context.options.resourceScopes }),
  })
}

const metadata: Route = (context) => {
  const origin = context.url.origin
  const kind = context.options.authorizationMetadata ?? "oauth"
  const path = context.options.issuerPath ?? ""
  const document = {
    issuer: context.issuer,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    ...context.options.metadata,
  }
  if (kind === "oauth" && context.url.pathname === `/.well-known/oauth-authorization-server${path}`)
    return Response.json(document)
  if (kind === "openid" && context.url.pathname === `/.well-known/openid-configuration${path}`)
    return Response.json({
      ...document,
      jwks_uri: `${origin}/jwks`,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    })
  return null
}

const register: Route = (context) =>
  context.url.pathname === "/register"
    ? new Response(context.body.replace(/^\{/u, '{"client_id":"registered-client",'), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    : null

const token: Route = (context) => {
  if (context.url.pathname !== "/token") return null
  const answer = (context.options.token ?? (() => bearer("tok_signin", { refresh_token: "ref_1", expires_in: 3600 })))(
    context.form,
  )
  return Response.json(answer.body, { status: answer.status })
}

const routes = [mcp, resource, metadata, register, token]

export const start = (initial: Options = {}): Instance => {
  const instance: { options: Options; seen: Array<Seen> } = { options: initial, seen: [] }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const body = request.method === "POST" ? await request.text() : ""
      const form = new URLSearchParams(url.pathname === "/register" ? "" : body)
      instance.seen.push({ path: url.pathname, form, authorization: request.headers.get("authorization") })
      const context = {
        url,
        options: instance.options,
        issuer: `${url.origin}${instance.options.issuerPath ?? ""}`,
        body,
        form,
      }
      return routes.map((route) => route(context)).find((response) => response !== null) ??
        new Response("not found", { status: 404 })
    },
  })
  const origin = `http://127.0.0.1:${server.port}`
  return Object.assign(instance, {
    origin,
    mcpUrl: `${origin}/mcp`,
    get issuer() {
      return `${origin}${instance.options.issuerPath ?? ""}`
    },
    stop: () => server.stop(true),
  })
}
