import { Layer, Schema } from "effect"
import { Auth } from "../../src/auth.js"
import { Routes } from "../../src/routes.js"
import { authRequest, makeApp, origin, sessionCookie, signUp } from "./app.js"

export const base = "http://localhost:4000"
export const resource = `${base}/mcp`
const clientId = "https://client.example/oauth/client.json"
const redirectUri = "http://127.0.0.1:33418/callback"

const clientMetadata = {
  client_id: clientId,
  client_name: "Example client",
  redirect_uris: [redirectUri],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  application_type: "native",
}

type App = ReturnType<typeof makeApp>

const json =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  async (response: Response) =>
    Schema.decodeUnknownSync(Schema.fromJsonString(schema))(await response.text())

export const Redirect = json(Schema.Struct({ url: Schema.String }))

const Me = json(Schema.Struct({ organization: Schema.Struct({ id: Schema.String }) }))

const Token = json(Schema.Struct({ access_token: Schema.String }))

const Result = Schema.fromJsonString(Schema.Struct({ result: Schema.Record(Schema.String, Schema.Unknown) }))

export const makeMcpApp = () =>
  makeApp(
    Routes.layer.pipe(
      Layer.provide(
        Layer.succeed(Auth.ClientMetadataFetch, (input) =>
          Promise.resolve(
            new Request(input).url === clientId
              ? Response.json(clientMetadata, { headers: { "cache-control": "max-age=60" } })
              : new Response(null, { status: 404 }),
          ),
        ),
      ),
    ),
  )

const challenge = async (verifier: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url")

export const startAuthorization = async (
  app: App,
  options: { cookie?: string; prompt?: string; scope?: string } = {},
) => {
  const verifier = crypto.randomUUID() + crypto.randomUUID()
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: options.scope ?? "openid offline_access ren",
    state: "state-1",
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    resource,
    ...(options.prompt !== undefined && { prompt: options.prompt }),
  })
  const authorized = await app.handler(
    new Request(`${base}/auth/oauth2/authorize?${query}`, { headers: { cookie: options.cookie ?? "" } }),
  )
  return { page: new URL(authorized.headers.get("location") ?? ""), verifier }
}

export const finishAuthorization = async (
  app: App,
  cookie: string,
  consentPage: URL,
  verifier: string,
  organizationId: string,
  tokenHeaders: Record<string, string> = {},
) => {
  const consent = await app.handler(
    new Request(`${base}/auth/oauth2/consent`, {
      method: "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        [Auth.consentOrganizationHeader]: organizationId,
      },
      body: JSON.stringify({ accept: true, oauth_query: consentPage.search.slice(1) }),
    }),
  )
  const callback = new URL((await Redirect(consent)).url)
  const token = await app.handler(
    new Request(`${base}/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...tokenHeaders },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code") ?? "",
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    }),
  )
  return { callback, token }
}

export const authorize = async (app: App, cookie: string, organizationId: string) => {
  const started = await startAuthorization(app, { cookie })
  return {
    consentPage: started.page,
    ...(await finishAuthorization(app, cookie, started.page, started.verifier, organizationId)),
  }
}

export const tokenFor = async (app: App, cookie: string, organizationId: string) =>
  (await Token((await authorize(app, cookie, organizationId)).token)).access_token

export const organizationOf = async (app: App, cookie: string) =>
  (await Me(await app.handler(new Request(`${base}/me`, { headers: { cookie } })))).organization.id

export const accessToken = async (app: App, email: string) => {
  const cookie = sessionCookie(await signUp(app, email))
  const organizationId = await organizationOf(app, cookie)
  return { cookie, organizationId, token: await tokenFor(app, cookie, organizationId) }
}

const Invitation = json(Schema.Struct({ id: Schema.String }))

export const joinOrganization = async (app: App, ownerCookie: string, email: string) => {
  const cookie = sessionCookie(await signUp(app, email))
  const invitation = await Invitation(
    await app.handler(authRequest("/organization/invite-member", { email, role: "member" }, ownerCookie)),
  )
  await app.handler(authRequest("/organization/accept-invitation", { invitationId: invitation.id }, cookie))
  return cookie
}

export const mcp = (app: App, body: unknown, headers: Record<string, string> = {}) =>
  app.handler(
    new Request(resource, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
  )

export const result = async (response: Response) => {
  const text = await response.text()
  const json = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("")
  return Schema.decodeUnknownSync(Result)(json).result
}

export const modern = (app: App, token: string, method: string, params: Record<string, unknown> = {}) =>
  mcp(
    app,
    {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    {
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof params.name === "string" && { "mcp-name": params.name }),
    },
  )
