import { afterAll, describe, expect, test } from "bun:test"
import { decodeJwt } from "jose"
import { origin, sessionCookie, signUp } from "./lib/app.js"
import { Redirect, authorize, base, finishAuthorization, makeMcpApp, resource, startAuthorization } from "./lib/mcp.js"

const app = makeMcpApp()

afterAll(() => app.dispose())

const get = (path: string, headers: HeadersInit = {}) => app.handler(new Request(`${base}${path}`, { headers }))

describe("Ren MCP OAuth", () => {
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
    const organizationId: string = (await (await get("/me", { cookie })).json()).organization.id
    const flow = await finishAuthorization(app, cookie, consentPage, started.verifier)
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
    const organizationId: string = (await (await get("/me", { cookie })).json()).organization.id
    const flow = await authorize(app, cookie)
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
})
