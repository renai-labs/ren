export * as Feedback from "./feedback.js"

import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { Actor } from "./actor.js"

export interface Report {
  readonly actor: Actor.Info
  readonly via: "mcp" | "cli" | "api"
  readonly message: string
}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Feedback.Unavailable", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly report: (report: Report) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Feedback") {}

const via = { mcp: "Ren MCP", cli: "CLI", api: "API" }

const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const field = (title: string, value: string) => ({ type: "mrkdwn", text: `*${title}*\n${value}` })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const app = (yield* Config.String("APP_URL").pipe(Effect.orDie)).replace(/\/$/u, "")
    const webhook = Option.filter(
      yield* Config.option(Config.Redacted("SLACK_FEEDBACK_WEBHOOK_URL")),
      (value) => Redacted.value(value) !== "",
    )
    return Service.of({
      report: Effect.fn("Feedback.report")(function* (report: Report) {
        const sender = (yield* database.db
          .select({ email: Database.Schema.user.email, organization: Database.Schema.organization.name })
          .from(Database.Schema.user)
          .innerJoin(Database.Schema.organization, eq(Database.Schema.organization.id, report.actor.organizationId))
          .where(eq(Database.Schema.user.id, report.actor.userId))
          .pipe(Effect.orDie)).at(0)
        const agent = report.actor.agent
        const chat = agent
          ? (yield* database.db
              .select({ space: Database.Schema.space.name, agent: Database.Schema.agent.name })
              .from(Database.Schema.space)
              .innerJoin(Database.Schema.agent, eq(Database.Schema.agent.id, agent.agentId))
              .where(eq(Database.Schema.space.id, agent.spaceId))
              .pipe(Effect.orDie)).at(0)
          : undefined
        const email = sender?.email ?? report.actor.userId
        const fields = [
          field("Via", via[report.via]),
          field("User", escaped(email)),
          field("Org", escaped(sender?.organization ?? report.actor.organizationId)),
          ...(agent
            ? [
                field("Space", escaped(chat?.space ?? agent.spaceId)),
                field("Agent", escaped(chat?.agent ?? agent.agentId)),
                field("Chat", `<${app}/sessions/${agent.sessionId}|${agent.sessionId}>`),
              ]
            : []),
        ]
        const message = escaped(report.message)
        if (Option.isNone(webhook)) {
          yield* Effect.logWarning(
            `SLACK_FEEDBACK_WEBHOOK_URL is not set, so this feedback only reaches the log:\n${fields.map((each) => each.text.replace("\n", " ")).join("\n")}\n---\n${message}`,
          )
          return
        }
        yield* HttpClientRequest.post(Redacted.value(webhook.value)).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            text: `Feedback from ${email}`,
            blocks: [
              { type: "section", fields },
              { type: "divider" },
              { type: "section", text: { type: "mrkdwn", text: message } },
            ],
            unfurl_links: false,
            unfurl_media: false,
          }),
          client.execute,
          Effect.timeout("10 seconds"),
          Effect.catch((cause) =>
            Effect.logError("Feedback did not reach Slack", cause).pipe(
              Effect.andThen(new Unavailable({ message: "Ren could not deliver the feedback. Try again later." })),
            ),
          ),
        )
      }),
    })
  }),
)
