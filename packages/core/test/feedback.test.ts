import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Context, Effect, Layer, Queue, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Feedback } from "../src/feedback.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const webhook = "https://hooks.slack.test/services/T0/B0/feedback"

const Posted = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))

class Inbox extends Context.Service<
  Inbox,
  { readonly next: Effect.Effect<{ readonly url: string; readonly body: typeof Posted.Type }> }
>()("test/Feedback/Inbox") {}

const slack = (status: number) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const posts = yield* Queue.unbounded<{ readonly url: string; readonly body: typeof Posted.Type }>()
      const client = HttpClient.make((request) =>
        Effect.gen(function* () {
          const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
          yield* Queue.offer(posts, {
            url: request.url,
            body: yield* Schema.decodeEffect(Posted)(body).pipe(Effect.orDie),
          })
          return HttpClientResponse.fromWeb(request, new Response(status === 200 ? "ok" : "no_service", { status }))
        }),
      )
      return Context.make(HttpClient.HttpClient, client).pipe(Context.add(Inbox, Inbox.of({ next: Queue.take(posts) })))
    }),
  )

const layer = (status = 200) =>
  Feedback.layer.pipe(
    Layer.provideMerge(slack(status)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({ SLACK_FEEDBACK_WEBHOOK_URL: webhook, APP_URL: "https://ren.test/app/" }),
        { asPrimary: true },
      ),
    ),
  )

const field = (title: string, value: string) => ({ type: "mrkdwn", text: `*${title}*\n${value}` })

describe("Feedback", () => {
  testEffect(layer()).live(
    "posts a grid of who sent the feedback and from where, then the feedback itself, escaped for Slack",
    () =>
      Effect.gen(function* () {
        const feedback = yield* Feedback.Service
        const inbox = yield* Inbox
        const owner = yield* Seed.owner()
        const agentId = yield* Seed.agent(owner, "researcher", { isSubagent: false })
        const sessionId = Session.ID.create()
        const actor = {
          userId: owner.createdBy,
          organizationId: owner.organizationId,
          roles: ["owner"],
        }
        const email = `${owner.createdBy.toLowerCase()}@example.com`

        yield* feedback.report({ actor, via: "cli", message: "The CLI hides <!channel> & errors.\nPlease fix." })
        expect(yield* inbox.next).toEqual({
          url: webhook,
          body: {
            text: `Feedback from ${email}`,
            blocks: [
              { type: "section", fields: [field("Via", "CLI"), field("User", email), field("Org", "Northstar")] },
              { type: "divider" },
              {
                type: "section",
                text: { type: "mrkdwn", text: "The CLI hides &lt;!channel&gt; &amp; errors.\nPlease fix." },
              },
            ],
            unfurl_links: false,
            unfurl_media: false,
          },
        })

        yield* feedback.report({
          actor: { ...actor, agent: { agentId, sessionId, spaceId: owner.spaceId, fence: null } },
          via: "mcp",
          message: "A tool is missing.",
        })
        expect((yield* inbox.next).body.blocks).toEqual([
          {
            type: "section",
            fields: [
              field("Via", "Ren MCP"),
              field("User", email),
              field("Org", "Northstar"),
              field("Space", "Team"),
              field("Agent", "researcher"),
              field("Chat", `<https://ren.test/app/sessions/${sessionId}|${sessionId}>`),
            ],
          },
          { type: "divider" },
          { type: "section", text: { type: "mrkdwn", text: "A tool is missing." } },
        ])
      }),
  )

  testEffect(layer(500)).live("fails as unavailable when Slack refuses the post", () =>
    Effect.gen(function* () {
      const feedback = yield* Feedback.Service
      const owner = yield* Seed.owner()
      const error = yield* Effect.flip(
        feedback.report({
          actor: { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] },
          via: "api",
          message: "Hi",
        }),
      )
      expect(error._tag).toBe("Feedback.Unavailable")
    }),
  )
})
