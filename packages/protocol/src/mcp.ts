export * as Mcp from "./mcp.js"

import { Context, Option } from "effect"
import type { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Exposure } from "./exposure.js"

// oxlint-disable-next-line ren/no-comments -- The reason an SDK endpoint is not a Ren MCP tool.
export class Hidden extends Context.Service<Hidden, string>()("@ren/protocol/Mcp/Hidden") {}

export const isTool = (options: { readonly group: HttpApiGroup.Top; readonly endpoint: HttpApiEndpoint.Top }) =>
  Context.getOrUndefined(options.group.annotations, Exposure) === "sdk" &&
  Option.isNone(Context.getOption(options.endpoint.annotations, Hidden))
