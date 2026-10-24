import { afterAll, expect } from "bun:test"
import { Effect } from "effect"
import { McpProvider } from "../src/mcp-provider.js"
import { ComposioTest } from "./lib/composio.js"
import { ComposioServer } from "./lib/composio-server.js"
import { testEffect } from "./lib/effect.js"

const server = ComposioServer.start()
afterAll(() => server.stop())

const it = testEffect(ComposioTest.layer(server, []))

it.live(
  "an account that stays INITIATED for 10 seconds fails the connect and starts its cleanup (test 20, K23)",
  () =>
    Effect.gen(function* () {
      server.activeAfterReads = 0
      const started = yield* ComposioTest.connect(yield* ComposioTest.setup())
      const accountId = [...server.accounts.keys()].at(-1) ?? ""
      expect(yield* ComposioTest.callback(started.state)).toEqual({
        ok: false,
        reason: "Composio did not finish the connection.",
      })
      const cleanup = yield* McpProvider.Cleanup
      yield* cleanup.wait({ provider: "composio", accountId })
      expect(server.accounts.has(accountId)).toBe(false)
      expect(yield* ComposioTest.stored("MCP_GMAIL")).toBeUndefined()
    }),
  30_000,
)
