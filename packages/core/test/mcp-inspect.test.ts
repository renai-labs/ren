import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { McpInspect } from "../src/mcp-inspect.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { testEffect } from "./lib/effect.js"
import { OAuthServer } from "./lib/oauth-server.js"

const servers: Array<{ stop: (force: boolean) => void }> = []
afterAll(() => {
  for (const server of servers) server.stop(true)
})

const serve = (handle: (request: Request, body: { method?: string; id?: number; params?: unknown }) => Response) => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => handle(request, request.method === "POST" ? await request.json() : {}),
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}/mcp`
}

const sessions: Array<string | null> = []

const open = serve((request, body) => {
  if (body.method === "initialize")
    return Response.json(
      {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: {
            name: "acme",
            title: "Acme MCP",
            version: "1.4",
            icons: [{ src: "https://acme.dev/icon.png" }],
            websiteUrl: "https://acme.dev",
          },
        },
      },
      { headers: { "mcp-session-id": "session-1" } },
    )
  if (body.method !== "tools/list") return new Response(null, { status: 202 })
  sessions.push(request.headers.get("mcp-session-id"))
  const first = {
    tools: [
      { name: "update_doc", description: " Change a doc " },
      { name: "search_docs", description: "Search", annotations: { readOnlyHint: false } },
    ],
    nextCursor: "2",
  }
  return JSON.stringify(body.params) === "{}"
    ? new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: first })}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    : Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "get_page" }] } })
})

const basic = serve((request) =>
  new URL(request.url).pathname === "/.well-known/mcp/server-card.json"
    ? Response.json({
        serverInfo: { name: "acme-docs", title: "Acme Docs" },
        description: "Search Acme’s docs",
        tools: [{ name: "list_docs", description: "List docs" }],
      })
    : new Response(null, { status: 401, headers: { "www-authenticate": 'Basic realm="acme"' } }),
)

const bearer = serve(() => new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer realm="acme"' } }))

const oauth = OAuthServer.start({ challenge: { scope: "docs:read docs:write" } })
servers.push(oauth)

const gone = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const goneUrl = `http://127.0.0.1:${gone.port}/mcp`
void gone.stop(true)

const it = testEffect(McpInspect.layer.pipe(Layer.provide(OAuthFetch.layerUnchecked)))

const inspect = (url: string) => McpInspect.Service.use((service) => service.inspect(url))

describe("McpInspect", () => {
  it.live("reads a server without auth: its info and every page of tools, in one session", () =>
    Effect.gen(function* () {
      expect(yield* inspect(open)).toEqual({
        reachable: true,
        server: {
          name: "acme",
          title: "Acme MCP",
          version: "1.4",
          icon: "https://acme.dev/icon.png",
          websiteUrl: "https://acme.dev",
        },
        auth: { type: "none" },
        tools: [
          { name: "get_page", description: "", readOnly: true },
          { name: "search_docs", description: "Search", readOnly: false },
          { name: "update_doc", description: "Change a doc", readOnly: false },
        ],
        readOnlyInferred: 2,
        source: "tools-list",
        problem: null,
      })
      expect(sessions).toEqual(["session-1", "session-1"])
    }),
  )

  it.live("finds a sign-in, its scopes and how Ren gets a client", () =>
    Effect.gen(function* () {
      expect((yield* inspect(oauth.mcpUrl)).auth).toEqual({
        type: "oauth",
        scopes: ["docs:read", "docs:write"],
        client: "registration",
      })
      oauth.options = {
        challenge: {},
        resourceScopes: ["docs"],
        metadata: { client_id_metadata_document_supported: true },
      }
      expect((yield* inspect(oauth.mcpUrl)).auth).toEqual({
        type: "oauth",
        scopes: ["docs"],
        client: "metadata-document",
      })
      oauth.options = { metadata: { registration_endpoint: undefined } }
      expect((yield* inspect(oauth.mcpUrl)).auth).toEqual({ type: "oauth", scopes: [], client: "oauth-app" })
    }),
  )

  it.live("reads the scheme of a challenge without sign-in metadata, and tools from the server card", () =>
    Effect.gen(function* () {
      expect(yield* inspect(basic)).toEqual({
        reachable: true,
        server: { name: "acme-docs", title: "Acme Docs", description: "Search Acme’s docs" },
        auth: { type: "basic" },
        tools: [{ name: "list_docs", description: "List docs", readOnly: true }],
        readOnlyInferred: 1,
        source: "server-card",
        problem: null,
      })
      expect(yield* inspect(bearer)).toEqual({
        reachable: true,
        server: null,
        auth: { type: "bearer" },
        tools: null,
        readOnlyInferred: 0,
        source: null,
        problem: null,
      })
    }),
  )

  it.live("says why when the server does not answer", () =>
    Effect.gen(function* () {
      const result = yield* inspect(goneUrl)
      expect(result).toMatchObject({ reachable: false, server: null, auth: { type: "unknown" }, tools: null })
      expect(result.problem).toBeString()
    }),
  )
})
