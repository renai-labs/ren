export * as RenderGroup from "./render-group.js"

import type { Schema } from "effect"
import { ClientTree } from "./client-tree.js"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { RenderSchemas } from "./render-schemas.js"
import { SchemaShape } from "./schema-shape.js"
import type { Types } from "./types.js"

type SourceSlots = Readonly<Record<Types.InputField["source"], RenderSchemas.Slot | undefined>>

function addSlot(slots: Array<RenderSchemas.Slot>, schema: Schema.Top, name: string) {
  const slot = { name, schema }
  slots.push(slot)
  return slot
}

function renderSuccess(slots: Array<RenderSchemas.Slot>, schema: Schema.Top, name: string) {
  if (!SchemaShape.isStreamSchema(schema)) return { source: addSlot(slots, schema, name).name }
  const status = SchemaShape.resolveHttpApiStatus(schema.ast) ?? 200
  const annotate = status === 200 ? "" : `.pipe(HttpApiSchema.status(${status}))`
  if (schema._tag === "StreamUint8Array") {
    return {
      source: `HttpApiSchema.StreamUint8Array({ contentType: ${JSON.stringify(schema.contentType)} })${annotate}`,
    }
  }
  const value = addSlot(
    slots,
    SchemaShape.streamEventSchema(schema),
    `${name}${schema.sseMode === "data" ? "Data" : "Events"}`,
  )
  const error = addSlot(slots, schema.error, `${name}Error`)
  return {
    source: `HttpApiSchema.StreamSse({ ${schema.sseMode}: ${value.name}, error: ${error.name}, contentType: ${JSON.stringify(schema.contentType)} })${annotate}`,
    streamError: error,
  }
}

function renderRequestPart(endpoint: Types.Endpoint, source: Types.InputField["source"], present: boolean) {
  const fields = endpoint.input.filter((field) => field.source === source)
  const first = fields[0]
  if (first === undefined) return present ? `${source}: { }` : undefined
  const access = (name: string) =>
    `input${endpoint.operation.inputMode === "optional" ? "?." : ""}[${JSON.stringify(name)}]`
  if (SchemaShape.isOpaquePayload(endpoint) && source === "payload") return `${source}: ${access(first.name)}`
  return `${source}: { ${fields.map((field) => `${JSON.stringify(field.name)}: ${access(field.name)}`).join(", ")} }`
}

export function renderEffectRequest(
  endpoint: Types.Endpoint,
  schemaBySource: Readonly<Record<Types.InputField["source"], unknown>>,
) {
  return (["params", "query", "headers", "payload"] as const)
    .map((source) => renderRequestPart(endpoint, source, schemaBySource[source] !== undefined))
    .filter((part): part is string => part !== undefined)
    .join(", ")
}

function renderInputType(group: Types.Group, operation: Types.Endpoint, schemaBySource: SourceSlots) {
  return operation.input
    .map((field) => {
      const slot = schemaBySource[field.source]
      if (slot === undefined) {
        throw new Errors.GenerationError({
          reason: `Missing input schema: ${group.identifier}.${operation.endpoint.identifier}`,
        })
      }
      const type =
        SchemaShape.isOpaquePayload(operation) && field.source === "payload"
          ? `typeof ${slot.name}.Type`
          : `(typeof ${slot.name}.Type)[${JSON.stringify(field.name)}]`
      return `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${type}`
    })
    .join("; ")
}

function renderAdapter(
  group: Types.Group,
  operation: Types.Endpoint,
  prefix: string,
  schemaBySource: SourceSlots,
  errorSlots: ReadonlyArray<RenderSchemas.Slot>,
  streamError: RenderSchemas.Slot | undefined,
) {
  const inputMode = operation.operation.inputMode
  const declared = [...errorSlots, ...(streamError === undefined ? [] : [streamError])]
  const declaredSchema =
    declared.length === 0 ? "Schema.Never" : `Schema.Union([${declared.map((slot) => slot.name).join(", ")}])`
  const opaquePayload = SchemaShape.isOpaquePayload(operation)
  const identifier = JSON.stringify(operation.endpoint.identifier)
  // oxlint-disable-next-line ren/no-comments -- HttpApiClient distributes union payloads into union request objects while the flattened input holds one object with a union value; TypeScript cannot correlate the equivalent shapes.
  const rawCall = `raw[${identifier}]({ ${renderEffectRequest(operation, schemaBySource)} }${opaquePayload ? ` as ${prefix}Request` : ""})`
  const mapped = `${rawCall}.pipe(Effect.mapError(map${prefix}Error)${operation.unwrapData ? ", Effect.map((value) => value.data)" : ""})`
  const inputDeclaration =
    inputMode === "none"
      ? ""
      : `${opaquePayload ? `type ${prefix}Request = Parameters<RawGroup[${identifier}]>[0]\n` : ""}type ${prefix}Input = { ${renderInputType(group, operation, schemaBySource)} }\n`
  const argument = inputMode === "none" ? "" : `input${inputMode === "optional" ? "?" : ""}: ${prefix}Input`
  const body =
    operation.operation.success === "stream"
      ? `Stream.unwrap(${rawCall}.pipe(Effect.mapError(map${prefix}Error), Effect.map((stream) => stream.pipe(Stream.mapError(map${prefix}Error)))))`
      : mapped
  return `${inputDeclaration}const ${prefix}DeclaredError = ${declaredSchema}\nconst map${prefix}Error = (error: unknown) => HttpClientError.isHttpClientError(error) || Schema.isSchemaError(error) || Sse.Retry.is(error) ? new ClientError({ cause: error }) : Schema.is(${prefix}DeclaredError)(error) ? error : new ClientError({ cause: error })\nconst ${prefix} = (raw: RawGroup) => (${argument}) => ${body}`
}

function renderEndpoint(group: Types.Group, operation: Types.Endpoint, slots: Array<RenderSchemas.Slot>) {
  const prefix = `Endpoint${operation.clientPath.map(Names.identifierPart).join("")}`
  const add = (schema: Schema.Top, name: string) => addSlot(slots, schema, name)
  const params = operation.params === undefined ? undefined : add(operation.params, `${prefix}Params`)
  const query = operation.query === undefined ? undefined : add(operation.query, `${prefix}Query`)
  const headers = operation.headers === undefined ? undefined : add(operation.headers, `${prefix}Headers`)
  const payloads = operation.payloads.map((schema, index) => add(schema, `${prefix}Payload${index}`))
  const success = renderSuccess(slots, operation.successes[0], `${prefix}Success`)
  const errorSlots = operation.errors.map((error, index) => add(error.schema, `${prefix}Error${index}`))
  const names = (list: ReadonlyArray<RenderSchemas.Slot>) => list.map((slot) => slot.name).join(", ")
  const options = [
    params === undefined ? undefined : `params: ${params.name}`,
    query === undefined ? undefined : `query: ${query.name}`,
    headers === undefined ? undefined : `headers: ${headers.name}`,
    payloads.length === 0 ? undefined : `payload: ${payloads.length === 1 ? names(payloads) : `[${names(payloads)}]`}`,
    `success: ${success.source}`,
    errorSlots.length === 0
      ? undefined
      : `error: ${errorSlots.length === 1 ? names(errorSlots) : `[${names(errorSlots)}]`}`,
  ].filter((option): option is string => option !== undefined)
  const endpoint = operation.endpoint
  return {
    adapter: renderAdapter(
      group,
      operation,
      prefix,
      { params, query, headers, payload: payloads[0] },
      errorSlots,
      success.streamError,
    ),
    source: `HttpApiEndpoint.make(${JSON.stringify(endpoint.method)})(${JSON.stringify(endpoint.identifier)}, ${JSON.stringify(endpoint.path)}, { ${options.join(", ")} })`,
  }
}

export function renderGroup(group: Types.Group) {
  const slots: Array<RenderSchemas.Slot> = []
  const endpoints = group.endpoints.map((operation) => renderEndpoint(group, operation, slots))
  const declarations = RenderSchemas.renderSchemas(slots)
  const groupSource = `HttpApiGroup.make(${JSON.stringify(group.identifier)}, { topLevel: ${group.endpoints[0]?.topLevel ?? false} })${endpoints.map((endpoint) => `.add(${endpoint.source})`).join("")}`
  const usesHttpApiSchema = endpoints.some((endpoint) => endpoint.source.includes("HttpApiSchema."))
  const methods = ClientTree.renderClientTree(
    group.endpoints,
    (item) => `Endpoint${item.clientPath.map(Names.identifierPart).join("")}(raw)`,
    (name, value) => `${JSON.stringify(name)}: ${value}`,
    ", ",
  )
  const name = Names.groupTypeName(group)
  const rawGroup = group.endpoints[0]?.topLevel
    ? `HttpApiClient.Client<typeof Group${name}>`
    : `HttpApiClient.Client.Group<typeof Group${name}, never, never>`
  const usesStream = group.endpoints.some((item) => item.operation.success === "stream")
  const adapters = endpoints.map((endpoint) => endpoint.adapter)
  return `// Generated by @ren/httpapi-codegen. Do not edit.\nimport { Effect, Schema${usesStream ? ", Stream" : ""} } from "effect"\nimport { Sse } from "effect/encoding"\nimport { HttpClientError } from "effect/http"\nimport { HttpApiClient, HttpApiEndpoint, HttpApiGroup${usesHttpApiSchema ? ", HttpApiSchema" : ""} } from "effect/http-api"\nimport { ClientError } from "./client-error.js"\n\n${declarations}\n\nexport const Group${name} = ${groupSource}\n\ntype RawGroup = ${rawGroup}\n\n${adapters.join("\n\n")}\n\nexport const adaptGroup${name} = (raw: RawGroup) => ({ ${methods} })\n`
}
