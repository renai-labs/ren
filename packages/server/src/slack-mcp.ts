export * as SlackMcp from "./slack-mcp.js"

import { Actor } from "@ren/core/actor"
import { Brains } from "@ren/core/brains"
import { SlackBot } from "@ren/core/slack-bot"
import { SlackGuides } from "@ren/core/slack-guides"
import { HostMcp } from "@ren/host-api/host-mcp"
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { McpProtocol, McpSchema, McpServer } from "effect/ai"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

export const path = HostMcp.channelPath("slack")

const instructions = [
  "Slack tools act as Ren’s bot in the Slack workspace of this space, not as a person.",
  "Text in this chat is not posted to Slack: answer the Slack thread that started the chat with slack_send_message, without channel_id.",
  "Write standard Markdown, never Slack mrkdwn. Put the answer first and keep it short; put long output in a file shown with show_file, and the answer posts it.",
  "Post in another channel, DM someone or schedule a message only when the person asked for it.",
  `Before writing more than a short answer, searching Slack or writing a canvas, read its guide with read_mcp_resource from the slack server: ${SlackGuides.guides.map((guide) => guide.uri).join(", ")}.`,
].join("\n")

const ObjectSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("object"),
    properties: Schema.Record(Schema.String, Schema.JsonObject),
    required: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({ not: Schema.Struct({ type: Schema.Literal("null") }) }),
])

class Caller extends Context.Service<Caller, Actor.AgentInfo>()("@ren/server/SlackMcp/Caller") {}

const tools = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer
    const bot = yield* SlackBot.Service
    yield* Effect.forEach(
      bot.tools,
      (tool) => {
        const document = Schema.toJsonSchemaDocument(tool.input)
        const object = Schema.decodeUnknownSync(ObjectSchema)(document.schema)
        const fields = "properties" in object ? object : { properties: {}, required: [] }
        return server.addTool({
          tool: new McpSchema.Tool({
            name: tool.name,
            description: tool.description,
            inputSchema: Schema.decodeUnknownSync(McpSchema.ToolJson)({
              type: "object",
              properties: fields.properties,
              required: fields.required ?? [],
              additionalProperties: false,
              ...(Object.keys(document.definitions).length > 0 && { $defs: document.definitions }),
            }),
            annotations: {
              readOnlyHint: !tool.posts,
              destructiveHint: tool.destructive,
              idempotentHint: !tool.posts,
              openWorldHint: true,
            },
          }),
          annotations: Context.empty(),
          handle: (payload) =>
            Effect.gen(function* () {
              const caller = yield* Effect.serviceOption(Caller)
              if (Option.isNone(caller))
                return yield* Effect.die(new Error(`Slack MCP ran ${tool.name} without a caller`))
              return yield* bot.call(caller.value, tool.name, payload ?? {}).pipe(
                Effect.map(
                  (result) =>
                    new McpSchema.CallToolResult({
                      isError: false,
                      content: [{ type: "text", text: JSON.stringify(result) }],
                    }),
                ),
                Effect.catchTag("SlackBot.Refused", (error) =>
                  Effect.succeed(
                    new McpSchema.CallToolResult({ isError: true, content: [{ type: "text", text: error.message }] }),
                  ),
                ),
              )
            }),
        })
      },
      { discard: true },
    )
  }),
)

const authentication = HttpRouter.middleware(
  Effect.gen(function* () {
    const brains = yield* Brains.Service
    const actors = yield* Actor.Service
    const callerOf = Effect.fnUntraced(function* (headers: Headers) {
      const token = /^Bearer\s+(\S+)$/iu.exec(headers.get("authorization") ?? "")?.at(1)
      const chat = HostMcp.chatOf(headers)
      if (!token || Option.isNone(chat)) return Option.none()
      const host = yield* brains.authenticateHost(Redacted.make(token)).pipe(Effect.option)
      if (Option.isNone(host)) return Option.none()
      return yield* actors
        .fromSession({ ...chat.value, organizationId: host.value.organizationId, brainId: host.value.brainId })
        .pipe(Effect.option)
    })
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const caller = yield* callerOf(new Headers(request.headers))
        if (Option.isNone(caller)) return HttpServerResponse.empty({ status: 401 })
        return yield* httpEffect.pipe(Effect.provideService(Caller, caller.value))
      })
  }),
).layer

const guides = Layer.effectDiscard(
  Effect.forEach(
    SlackGuides.guides,
    (guide) =>
      McpServer.registerResource({
        uri: guide.uri,
        name: guide.name,
        description: guide.description,
        mimeType: "text/markdown",
        audience: ["assistant"],
        content: Effect.succeed(guide.text),
      }),
    { discard: true },
  ),
)

export const layer = Layer.merge(tools, guides).pipe(
  Layer.provideMerge(
    McpServer.layerHttp({
      name: "slack",
      version: "0.0.0",
      instructions,
      path,
      protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
    }),
  ),
  Layer.provide(authentication),
  Layer.provide(Actor.layer),
)
