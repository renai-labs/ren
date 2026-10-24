import { afterAll, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { signUp } from "./lib/app.js"
import { accessToken, base, makeMcpApp, mcp, modern, result } from "./lib/mcp.js"

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

const discoverHeaders = { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" }

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
    const current = await mcp(app, discover, { authorization, ...discoverHeaders })
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

describe("Ren MCP tools", () => {
  test("lists a tool for each endpoint that is marked for Ren MCP, and no other", async () => {
    const caller = await accessToken(app, "tools@example.com")
    const listed = await result(await modern(app, caller.token, "tools/list"))
    expect(listed.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "me_get", annotations: expect.objectContaining({ readOnlyHint: true }) }),
        expect.objectContaining({
          name: "space_get",
          inputSchema: expect.objectContaining({ required: ["idOrSlug"] }),
        }),
      ]),
    )
    expect(listed.tools).not.toContainEqual(expect.objectContaining({ name: "space_archive" }))
  })

  test("runs a tool through its endpoint as the caller, in the protocol versions before and after 2026-07-28", async () => {
    const caller = await accessToken(app, "call@example.com")
    const current = await result(await modern(app, caller.token, "tools/call", { name: "me_get", arguments: {} }))
    expect(current).toMatchObject({
      isError: false,
      structuredContent: { user: { email: "call@example.com" }, organization: { id: caller.organizationId } },
    })
    const authorization = `Bearer ${caller.token}`
    const initialized = await mcp(app, initialize, { authorization })
    const session = { authorization, "mcp-session-id": initialized.headers.get("mcp-session-id") ?? "" }
    await mcp(app, { jsonrpc: "2.0", method: "notifications/initialized" }, session)
    const legacy = await mcp(
      app,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "me_get", arguments: {} } },
      { ...session, "mcp-protocol-version": "2025-11-25" },
    )
    expect(await result(legacy)).toMatchObject({
      content: current.content,
      structuredContent: current.structuredContent,
    })
  })

  test("splits the arguments of a tool into the path and the body of its endpoint", async () => {
    const caller = await accessToken(app, "write@example.com")
    const call = async (name: string, args: Record<string, unknown>) =>
      result(await modern(app, caller.token, "tools/call", { name, arguments: args }))
    const created = await call("space_create", { name: "Launch" })
    const id = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(created.structuredContent).id
    expect(created).toMatchObject({ isError: false, structuredContent: { name: "Launch" } })
    expect(await call("space_update", { id, name: "Launch week" })).toMatchObject({ isError: false })
    expect(await call("space_get", { idOrSlug: id })).toMatchObject({ structuredContent: { name: "Launch week" } })
  })

  test("returns a Ren API error or an argument that the endpoint refuses as a tool error", async () => {
    const caller = await accessToken(app, "missing@example.com")
    const missing = await result(
      await modern(app, caller.token, "tools/call", { name: "space_get", arguments: { idOrSlug: "spc_missing" } }),
    )
    expect(missing.isError).toBe(true)
    expect(missing.content).toEqual([{ type: "text", text: expect.stringMatching(/^NotFoundError: /) }])
    const invalid = await result(
      await modern(app, caller.token, "tools/call", { name: "space_update", arguments: { id: "bad", name: "x" } }),
    )
    expect(invalid).toMatchObject({ isError: true })
  })
})
