import { afterAll, describe, expect, test } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { decodeJwt } from "jose"
import { Routes } from "../src/routes.js"
import { authRequest, makeApp, origin, sessionCookie, signUp } from "./lib/app.js"
import {
  Redirect,
  authorize,
  base,
  finishAuthorization,
  makeMcpApp,
  organizationOf,
  resource,
  startAuthorization,
} from "./lib/mcp.js"

const app = makeMcpApp()
const offline = makeApp(Routes.layer)

afterAll(async () => {
  await app.dispose()
  await offline.dispose()
})

const get = (path: string, headers: HeadersInit = {}) => app.handler(new Request(`${base}${path}`, { headers }))

describe("Ren MCP OAuth", () => {
  test("binds consent to the organization the person chose, even after another tab switches the session", async () => {
    const cookie = sessionCookie(await signUp(app, "consent-race@example.com"))
    const chosen = await organizationOf(app, cookie)
    const started = await startAuthorization(app, { cookie })
    const other = await (
      await app.handler(authRequest("/organization/create", { name: "Other", slug: "consent-other" }, cookie))
    ).json()
    await app.handler(authRequest("/organization/set-active", { organizationId: other.id }, cookie))
    const flow = await finishAuthorization(app, cookie, started.page, started.verifier, chosen)
    expect(decodeJwt((await flow.token.json()).access_token)).toMatchObject({ ren_org: chosen })
    expect(await organizationOf(app, cookie)).toBe(other.id)
  })

  test("refuses consent without an organization or for an organization the person does not belong to", async () => {
    const cookie = sessionCookie(await signUp(app, "consent-member@example.com"))
    const stranger = await organizationOf(app, sessionCookie(await signUp(app, "consent-stranger@example.com")))
    const started = await startAuthorization(app, { cookie })
    const consent = (headers: Record<string, string>) =>
      app.handler(
        new Request(`${base}/auth/oauth2/consent`, {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json", ...headers },
          body: JSON.stringify({ accept: true, oauth_query: started.page.search.slice(1) }),
        }),
      )
    expect((await consent({})).status).toBe(403)
    expect((await consent({ [Auth.consentOrganizationHeader]: stranger })).status).toBe(403)
  })

  test("sends a client that asks to create an account to sign-up, and gives the new account a token for its new organization", async () => {
    const started = await startAuthorization(app, { prompt: "create" })
    expect(started.page.pathname).toBe("/app/signup")
    const signedUp = await app.handler(
      new Request(`${base}/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ name: "Grace", email: "new-mcp@example.com", password: "correct horse battery staple" }),
      }),
    )
    const cookie = sessionCookie(signedUp)
    const continued = await app.handler(
      new Request(`${base}/auth/oauth2/continue`, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({ created: true, oauth_query: started.page.search.slice(1) }),
      }),
    )
    const consentPage = new URL((await Redirect(continued)).url)
    expect(consentPage.pathname).toBe("/app/consent")
    const organizationId = await organizationOf(app, cookie)
    const flow = await finishAuthorization(app, cookie, consentPage, started.verifier, organizationId)
    expect(decodeJwt((await flow.token.json()).access_token)).toMatchObject({ ren_org: organizationId })
  })

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
    const organizationId = await organizationOf(app, cookie)
    const flow = await authorize(app, cookie, organizationId)
    expect(flow.consentPage.pathname).toBe("/app/consent")
    expect(flow.callback.searchParams.get("iss")).toBe(`${base}/auth`)
    expect(flow.token.status).toBe(200)
    const body = await flow.token.json()
    expect(body.refresh_token).toEqual(expect.any(String))
    expect(decodeJwt(body.access_token)).toMatchObject({
      iss: `${base}/auth`,
      aud: expect.arrayContaining([resource]),
      ren_org: organizationId,
    })
  })

  test("knows the Ren CLI without fetching its metadata and accepts its loopback callback on any port", async () => {
    const cookie = sessionCookie(await signUp(offline, "cli@example.com"))
    const organizationId = await organizationOf(offline, cookie)
    const client = { id: Auth.cliClient.client_id, redirectUri: "http://127.0.0.1:49152/callback" }
    const started = await startAuthorization(offline, { cookie, client })
    expect(started.page.pathname).toBe("/app/consent")
    const flow = await finishAuthorization(offline, cookie, started.page, started.verifier, organizationId)
    expect(flow.callback.origin).toBe("http://127.0.0.1:49152")
    const body = await flow.token.json()
    expect(body.refresh_token).toEqual(expect.any(String))
    expect(decodeJwt(body.access_token)).toMatchObject({ ren_org: organizationId })
  })
})
