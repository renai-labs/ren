import { afterAll, describe, expect } from "bun:test"
import { Seed, testEffect } from "@ren/core/testing"
import { HostMcp } from "@ren/host-api/host-mcp"
import { Brain } from "@ren/schema/brain"
import { Effect } from "effect"
import { ApiFixture } from "./lib/api-fixture.js"
import { config, hostToken } from "./lib/app.js"
import { mcp, result } from "./lib/mcp.js"

const posts: Array<{ readonly blocks: ReadonlyArray<{ readonly fields?: ReadonlyArray<{ readonly text: string }> }> }> =
  []

const slack = Bun.serve({
  port: 0,
  fetch: async (request) => {
    posts.push(await request.json())
    return new Response("ok")
  },
})

afterAll(() => slack.stop())

const it = testEffect(ApiFixture.layerWith({ config: { SLACK_FEEDBACK_WEBHOOK_URL: slack.url.href } }))

const fields = () =>
  posts
    .at(-1)
    ?.blocks.at(0)
    ?.fields?.map((field) => field.text)

describe("feedback.report", () => {
  it.live("marks feedback from the ren CLI apart from other API callers, as the signed-in person", () =>
    Effect.gen(function* () {
      const api = yield* ApiFixture.Service
      const owner = yield* ApiFixture.owner()
      const send = (headers: Record<string, string>) =>
        Effect.promise(() =>
          api.handler(
            new Request("http://localhost:4000/feedback", {
              method: "POST",
              headers: { cookie: owner.cookie, "content-type": "application/json", ...headers },
              body: JSON.stringify({ message: "The plan output is hard to read." }),
            }),
          ),
        )
      expect((yield* send({ "user-agent": "ren/1.2.3" })).status).toBe(204)
      expect(fields()).toEqual(["*Via*\nCLI", expect.stringContaining("*User*\n"), "*Org*\nNorthstar"])
      expect((yield* send({})).status).toBe(204)
      expect(fields()?.at(0)).toBe("*Via*\nAPI")
    }),
  )

  it.live("an agent sends feedback from its chat through Ren MCP, with a link to the chat", () =>
    Effect.gen(function* () {
      const api = yield* ApiFixture.Service
      yield* Seed.ren()
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner)
      const token = yield* hostToken(Brain.ofSession(sessionId), owner.organizationId)
      const answer = yield* Effect.promise(() =>
        mcp(
          api,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "feedback_report",
              arguments: { message: "I could not find a tool to rename a space." },
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          },
          {
            authorization: `Bearer ${token}`,
            [HostMcp.sessionHeader]: sessionId,
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "tools/call",
            "mcp-name": "feedback_report",
          },
        ).then(result),
      )
      expect(answer).toMatchObject({ isError: false })
      expect(fields()).toEqual([
        "*Via*\nRen MCP",
        expect.stringContaining("*User*\n"),
        "*Org*\nNorthstar",
        "*Space*\nTeam",
        "*Agent*\nren",
        `*Chat*\n<${config.APP_URL}/sessions/${sessionId}|${sessionId}>`,
      ])
    }),
  )
})
