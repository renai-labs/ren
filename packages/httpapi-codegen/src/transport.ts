export * as Transport from "./transport.js"

import { Schema } from "effect"
import type { HttpRouter } from "effect/http"
import { HttpApiEndpoint } from "effect/http-api"
import { Encoding } from "./encoding.js"
import { Errors } from "./errors.js"
import { Portable } from "./portable.js"
import { SchemaShape } from "./schema-shape.js"
import type { Types } from "./types.js"

function isPathInput(path: string): path is HttpRouter.PathInput {
  return path === "*" || path.startsWith("/")
}

function rebuild(
  endpoint: HttpApiEndpoint.Top,
  path: HttpRouter.PathInput,
  source: Types.InputField["source"] | "success" | "error",
  decoded: Schema.Top,
) {
  const make = HttpApiEndpoint.make(endpoint.method)
  switch (source) {
    case "params":
      return make(endpoint.identifier, path, { params: decoded, success: Schema.String }).params
    case "query":
      return make(endpoint.identifier, path, { query: decoded, success: Schema.String }).query
    case "headers":
      return make(endpoint.identifier, path, { headers: decoded, success: Schema.String }).headers
    case "payload":
      return [...make(endpoint.identifier, path, { payload: decoded, success: Schema.String }).payload.values()][0]
        ?.schemas[0]
    case "success":
      return [...make(endpoint.identifier, path, { success: decoded }).success][0]
    case "error":
      return [...make(endpoint.identifier, path, { success: Schema.String, error: decoded }).error][0]
  }
}

export function normalizeTransport(
  schema: Schema.Top,
  source: Types.InputField["source"] | "success" | "error",
  endpoint: HttpApiEndpoint.Top,
  operation: string,
) {
  if (SchemaShape.isStreamSchema(schema)) return { schema, effectPortable: true } as const
  if (!Portable.metadataPortable(schema.ast, new Set())) {
    if (source !== "success" && source !== "error") return { schema, effectPortable: false } as const
    throw new Errors.GenerationError({ reason: `Unportable schema: ${operation}.${source}` })
  }
  const decoded = Schema.toType(schema)
  if (!isPathInput(endpoint.path)) {
    throw new Errors.GenerationError({ reason: `Invalid endpoint path: ${operation}` })
  }
  const normalized = rebuild(endpoint, endpoint.path, source, decoded)
  if (normalized === undefined) {
    throw new Errors.GenerationError({ reason: `Unportable schema: ${operation}.${source}` })
  }
  if (!Encoding.sameEncoding(schema.ast, normalized.ast)) return { schema, effectPortable: false } as const
  return { schema: decoded, effectPortable: true } as const
}
