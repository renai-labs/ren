import { McpInspect } from "@ren/core/mcp-inspect"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"

export const McpInspectHandler = HttpApiBuilder.group(Api, "mcp-inspect", (handlers) =>
  Effect.gen(function* () {
    const inspector = yield* McpInspect.Service
    return handlers.handle("mcp.inspect", (request) => inspector.inspect(request.payload.url))
  }),
)
