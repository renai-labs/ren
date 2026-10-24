import { afterAll, describe, expect, test } from "bun:test"
import { decodeJwt } from "jose"
import { Layer } from "effect"
import { Auth } from "../src/auth.js"
import { Routes } from "../src/routes.js"
import { makeApp, sessionCookie, signUp } from "./lib/app.js"

const base = "http://localhost:4000"
const resource = `${base}/mcp`
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

const app = makeApp(
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

afterAll(() => app.dispose())

const get = (path: string, headers: HeadersInit = {}) => app.handler(new Request(`${base}${path}`, { headers }))

const challenge = async (verifier: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url")

describe("Ren MCP OAuth", () => {
  test("serves authorization server metadata for the /auth issuer with CIMD and without registration", async () => {
    const response = await get("/.well-known/oauth-authorization-server/auth")
    expect(response.status).toBe(200)
    const metadata = await response.json()
    expect(metadata).toMatchObject({
      issuer: `${base}/auth`,
      authorization_endpoint: `${base}/auth/oauth2/authorize`,
      token_endpoint: `${base}/auth/oauth2/token`,
      client_id_metadata_document_supported: true,
    })
    expect(metadata.registration_endpoint).toBeUndefined()
  })

  test.each(["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"])(
    "serves protected resource metadata for /mcp at %s",
    async (path) => {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        resource,
        authorization_servers: [`${base}/auth`],
        scopes_supported: ["ren"],
      })
    },
  )

  test("gives a CIMD client an access token for /mcp in the organization the person consented with", async () => {
    const cookie = sessionCookie(await signUp(app, "mcp@example.com", "Ada"))
    const organizationId: string = (await (await get("/me", { cookie })).json()).organization.id
    const verifier = crypto.randomUUID() + crypto.randomUUID()
    const authorize = new URL(`${base}/auth/oauth2/authorize`)
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid offline_access ren",
      state: "state-1",
      code_challenge: await challenge(verifier),
      code_challenge_method: "S256",
      resource,
    }).toString()
    const authorized = await get(`${authorize.pathname}${authorize.search}`, { cookie })
    expect(authorized.status).toBe(302)
    const consentPage = new URL(authorized.headers.get("location") ?? "")
    expect(consentPage.pathname).toBe("/app/consent")

    const consent = await app.handler(
      new Request(`${base}/auth/oauth2/consent`, {
        method: "POST",
        headers: { cookie, origin: "http://localhost:5173", "content-type": "application/json" },
        body: JSON.stringify({ accept: true, oauth_query: consentPage.search.slice(1) }),
      }),
    )
    expect(consent.status).toBe(200)
    const callback = new URL((await consent.json()).url)
    expect(callback.searchParams.get("iss")).toBe(`${base}/auth`)

    const token = await app.handler(
      new Request(`${base}/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
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
    expect(token.status).toBe(200)
    const body = await token.json()
    expect(body.refresh_token).toEqual(expect.any(String))
    expect(decodeJwt(body.access_token)).toMatchObject({
      iss: `${base}/auth`,
      aud: expect.arrayContaining([resource]),
      ren_org: organizationId,
    })
  })
})
