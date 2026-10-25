export * as RenMcp from "./ren-mcp.js"

import { Actor } from "@ren/core/actor"
import { Brains } from "@ren/core/brains"
import { HostMcp } from "@ren/host-api/host-mcp"
import { Mcp } from "@ren/protocol/mcp"
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { McpProtocol, McpSchema, McpServer } from "effect/ai"
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApi, type HttpApiEndpoint, OpenApi } from "effect/http-api"
import { Api } from "./api.js"
import { Auth } from "./auth.js"
import { McpCaller } from "./middleware/authentication.js"

const instructions = [
  "Ren runs teams of AI agents in spaces.",
  "Each tool operates the Ren API as the person who connected this server, in the organization that they chose.",
  "Ren keeps no current space or session: pass each ID as an argument.",
].join(" ")

const definitions = "#/$defs/"

const Reference = Schema.Struct({ $ref: Schema.String })

const ObjectSchema = Schema.Struct({
  type: Schema.Literal("object"),
  properties: Schema.Record(Schema.String, Schema.JsonObject),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
})

const Arguments = Schema.Record(Schema.String, Schema.Json)

const ApiError = Schema.fromJsonString(Schema.Struct({ _tag: Schema.String, message: Schema.String }))

const parameter = (value: Schema.Json) => (typeof value === "string" ? value : JSON.stringify(value))

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

const part = (location: "path" | "query" | "body", schema: Schema.Top) => {
  const document = Schema.toJsonSchemaDocument(schema)
  const root = Option.match(Schema.decodeUnknownOption(Reference)(document.schema), {
    onNone: () => document.schema,
    onSome: (reference) => document.definitions[reference.$ref.slice(definitions.length)] ?? document.schema,
  })
  const object = Schema.decodeUnknownOption(ObjectSchema)(root)
  return {
    location,
    properties: Option.match(object, { onNone: () => ({ body: root }), onSome: (value) => value.properties }),
    required: Option.match(object, { onNone: () => ["body"], onSome: (value) => value.required ?? [] }),
    merged: Option.isSome(object),
    definitions: document.definitions,
  }
}

const toTool = (endpoint: HttpApiEndpoint.Top, router: HttpRouter.HttpRouter) => {
  const name = endpoint.identifier.replaceAll(/[.-]/gu, "_")
  const payload = [...endpoint.payload.values()].at(0)?.schemas.at(0)
  const parts = [
    ...(endpoint.params ? [part("path", endpoint.params)] : []),
    ...(endpoint.query ? [part("query", endpoint.query)] : []),
    ...(payload ? [part("body", payload)] : []),
  ]
  const keys = parts.flatMap((value) => Object.keys(value.properties))
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Ren MCP tool ${name} has an argument in more than one part of its endpoint`)
  }
  const inputSchema = Schema.decodeUnknownSync(McpSchema.ToolJson)({
    type: "object",
    properties: Object.fromEntries(parts.flatMap((value) => Object.entries(value.properties))),
    required: parts.flatMap((value) => value.required),
    additionalProperties: false,
    $defs: Object.fromEntries(parts.flatMap((value) => Object.entries(value.definitions))),
  })
  const body = parts.find((value) => value.location === "body")
  const query = parts.find((value) => value.location === "query")
  const handle = Effect.fnUntraced(function* (payload: unknown) {
    const args = yield* Schema.decodeUnknownEffect(Arguments)(payload ?? {}).pipe(
      Effect.mapError(() => new McpSchema.InvalidParams({ message: `The arguments of ${name} must be an object.` })),
    )
    const caller = yield* Effect.serviceOption(McpCaller)
    const url = new URL(
      endpoint.path.replaceAll(/:(\w+)/gu, (_, key: string) => encodeURIComponent(parameter(args[key] ?? ""))),
      "http://localhost",
    )
    url.search = new URLSearchParams(
      Object.fromEntries(
        Object.keys(query?.properties ?? {}).flatMap((key) => {
          const value = args[key]
          // ast-grep-ignore: no-nullish-comparison, -- an empty string, 0 and false are values to send
          return value === undefined || value === null ? [] : [[key, parameter(value)]]
        }),
      ),
    ).toString()
    const content = body?.merged
      ? Object.fromEntries(Object.keys(body.properties).flatMap((key) => (key in args ? [[key, args[key]]] : [])))
      : args.body
    const request = new Request(url.href, {
      method: endpoint.method,
      headers: { "content-type": "application/json" },
      ...(body && { body: JSON.stringify(content ?? {}) }),
    })
    const dispatch = router
      .asHttpEffect()
      .pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)))
    const response = HttpServerResponse.toWeb(
      yield* Option.match(caller, {
        onNone: () => dispatch,
        onSome: (session) => dispatch.pipe(Effect.provideService(McpCaller, session)),
      }).pipe(
        Effect.scoped,
        Effect.catchCause((cause) => Effect.map(HttpServerError.causeResponse(cause), ([response]) => response)),
      ),
    )
    const text = yield* Effect.promise(() => response.text())
    if (response.ok) {
      return new McpSchema.CallToolResult({
        isError: false,
        content: [{ type: "text", text }],
        structuredContent: Option.getOrUndefined(decodeJson(text)),
      })
    }
    return new McpSchema.CallToolResult({
      isError: true,
      content: [
        {
          type: "text",
          text: Option.match(Schema.decodeUnknownOption(ApiError)(text), {
            onNone: () => `${response.status}: ${text}`,
            onSome: (error) => `${error._tag}: ${error.message}`,
          }),
        },
      ],
    })
  })
  return {
    tool: new McpSchema.Tool({
      name,
      title: Context.getOrUndefined(endpoint.annotations, OpenApi.Summary),
      description: Context.getOrUndefined(endpoint.annotations, OpenApi.Description),
      inputSchema,
      annotations: {
        readOnlyHint: endpoint.method === "GET",
        destructiveHint: endpoint.method === "DELETE",
        idempotentHint: endpoint.method !== "POST",
        openWorldHint: false,
      },
    }),
    annotations: Context.empty(),
    handle,
  }
}

const tools = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer
    const router = yield* HttpRouter.HttpRouter
    const endpoints: Array<HttpApiEndpoint.Top> = []
    HttpApi.reflect(Api, {
      predicate: (options) => Context.get(options.endpoint.annotations, Mcp.Tool),
      onGroup: () => {},
      onEndpoint: (options) => {
        endpoints.push(options.endpoint)
      },
    })
    yield* Effect.forEach(endpoints, (endpoint) => server.addTool(toTool(endpoint, router)), { discard: true })
  }),
)

const authentication = HttpRouter.middleware(
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const brains = yield* Brains.Service
    const actors = yield* Actor.Service
    const brainCaller = Effect.fnUntraced(function* (headers: Headers) {
      const token = /^Bearer\s+(\S+)$/iu.exec(headers.get("authorization") ?? "")?.at(1)
      const chat = HostMcp.chatOf(headers)
      if (!token || Option.isNone(chat)) return Option.none()
      const host = yield* brains.authenticateHost(Redacted.make(token)).pipe(Effect.option)
      if (Option.isNone(host)) return Option.none()
      const actor = yield* actors
        .fromSession({ ...chat.value, organizationId: host.value.organizationId, brainId: host.value.brainId })
        .pipe(Effect.option)
      if (Option.isNone(actor)) return Option.none()
      return yield* auth.actAs(actor.value)
    })
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const headers = new Headers(request.headers)
        const person = yield* auth.getAccessToken(headers)
        const caller = Option.isSome(person) ? person : yield* brainCaller(headers)
        if (Option.isNone(caller)) {
          return HttpServerResponse.empty({ status: 401, headers: { "www-authenticate": auth.mcpChallenge } })
        }
        return yield* httpEffect.pipe(Effect.provideService(McpCaller, caller.value))
      })
  }),
).layer

export const layer = tools.pipe(
  Layer.provideMerge(
    McpServer.layerHttp({
      name: "ren",
      version: "0.0.0",
      instructions,
      path: Auth.mcpPath,
      protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
    }),
  ),
  Layer.provide(authentication),
  Layer.provide(Actor.layer),
)
