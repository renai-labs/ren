export * as Mcp from "./mcp.js"

import { Effect, Layer, Option } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"

const instructions = [
  "Ren runs teams of AI agents in spaces.",
  "Each tool operates the Ren API as the person who connected this server, in the organization that they chose.",
  "Ren keeps no current space or session: pass each ID as an argument.",
].join(" ")

const authentication = HttpRouter.middleware(
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const caller = yield* auth.getAccessToken(new Headers(request.headers))
        if (Option.isNone(caller)) {
          return HttpServerResponse.empty({ status: 401, headers: { "www-authenticate": auth.mcpChallenge } })
        }
        return yield* httpEffect
      })
  }),
).layer

export const layer = McpServer.layerHttp({
  name: "ren",
  version: "0.0.0",
  instructions,
  path: Auth.mcpPath,
  protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
}).pipe(Layer.provide(authentication))
