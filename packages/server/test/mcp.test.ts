import { afterAll, describe, expect, test } from "bun:test"
import { signUp } from "./lib/app.js"
import { accessToken, base, makeMcpApp, mcp, result } from "./lib/mcp.js"

const app = makeMcpApp()

afterAll(() => app.dispose())

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
}

const discover = {
  jsonrpc: "2.0",
  id: 1,
  method: "server/discover",
  params: {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
}

const modern = { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" }

describe("POST /mcp", () => {
  test("answers a request without a token with 401 and the protected resource metadata", async () => {
    const response = await mcp(app, initialize)
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="ren"`,
    )
  })

  test("refuses a session token and a JWT for another audience", async () => {
    const session = (await signUp(app, "audience@example.com")).headers.get("set-auth-token") ?? ""
    const jwt: string = (
      await (
        await app.handler(new Request(`${base}/auth/token`, { headers: { authorization: `Bearer ${session}` } }))
      ).json()
    ).token
    expect(jwt.split(".")).toHaveLength(3)
    for (const token of [session, jwt]) {
      expect((await mcp(app, initialize, { authorization: `Bearer ${token}` })).status).toBe(401)
    }
  })

  test("serves initialize and server/discover to a caller with an access token", async () => {
    const caller = await accessToken(app, "discover@example.com")
    const authorization = `Bearer ${caller.token}`
    const legacy = await mcp(app, initialize, { authorization })
    expect(legacy.status).toBe(200)
    expect(await result(legacy)).toMatchObject({ serverInfo: { name: "ren" } })
    const current = await mcp(app, discover, { authorization, ...modern })
    expect(current.status).toBe(200)
    expect((await result(current)).supportedVersions).toContain("2026-07-28")
  })
})

describe("Ren API with an MCP access token", () => {
  test("serves the caller in the organization of the token", async () => {
    const caller = await accessToken(app, "api@example.com")
    const me = await app.handler(new Request(`${base}/me`, { headers: { authorization: `Bearer ${caller.token}` } }))
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({
      user: { email: "api@example.com" },
      organization: { id: caller.organizationId },
    })
  })
})
