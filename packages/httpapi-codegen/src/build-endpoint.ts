export * as BuildEndpoint from "./build-endpoint.js"

import { Context, Schema, SchemaAST } from "effect"
import type { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api"
import { HttpApiSchema, OpenApi } from "effect/http-api"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import { Portable } from "./portable.js"
import { SchemaShape } from "./schema-shape.js"
import { Transport } from "./transport.js"
import type { Types } from "./types.js"

export type Source = {
  readonly group: HttpApiGroup.Top
  readonly endpoint: HttpApiEndpoint.Top
  readonly middleware: ReadonlySet<HttpApiMiddleware.AnyService>
  readonly successes: ReadonlyMap<number, readonly [Schema.Top, ...Array<Schema.Top>]>
  readonly errors: ReadonlyMap<number, readonly [Schema.Top, ...Array<Schema.Top>]>
}

type Normalized = ReturnType<typeof Transport.normalizeTransport>

type Transports = {
  readonly params: Normalized | undefined
  readonly query: Normalized | undefined
  readonly headers: Normalized | undefined
  readonly payloads: ReadonlyArray<Normalized>
  readonly success: Normalized
  readonly errors: ReadonlyArray<Normalized & { readonly status: number }>
}

type Input = Types.Endpoint["input"]

function inputFields(schema: Schema.Top | undefined, source: Types.InputField["source"], operation: string) {
  if (schema === undefined) return []
  const ast = Schema.toType(schema).ast
  if (!SchemaAST.isObjects(ast) || ast.indexSignatures.length > 0) {
    if (source === "payload") return [{ name: "payload", source, optional: false }] as const
    throw new Errors.GenerationError({ reason: `Input schema must be a struct: ${operation}.${source}` })
  }
  return ast.propertySignatures.map((field) => {
    if (typeof field.name !== "string") {
      throw new Errors.GenerationError({ reason: `Input field must have a string name: ${operation}.${source}` })
    }
    return { name: field.name, source, optional: SchemaAST.isOptional(field.type) }
  })
}

function normalizeTransports(source: Source, name: string): Transports {
  const endpoint = source.endpoint
  const normalize = (schema: Schema.Top | undefined, kind: "params" | "query" | "headers") =>
    schema === undefined ? undefined : Transport.normalizeTransport(schema, kind, endpoint, name)
  const successSchemas = [...endpoint.success]
  if (successSchemas.length > 1) throw new Errors.GenerationError({ reason: `Multiple success schemas: ${name}` })
  const params = normalize(endpoint.params, "params")
  const query = normalize(endpoint.query, "query")
  const headers = normalize(endpoint.headers, "headers")
  const sourcePayloads = [...endpoint.payload.values()].flatMap((payload) => payload.schemas)
  if (sourcePayloads.length > 1) throw new Errors.GenerationError({ reason: `Multiple payload schemas: ${name}` })
  return {
    params,
    query,
    headers,
    payloads: sourcePayloads.map((schema) => Transport.normalizeTransport(schema, "payload", endpoint, name)),
    success: Transport.normalizeTransport(successSchemas[0] ?? HttpApiSchema.NoContent, "success", endpoint, name),
    errors: [...source.errors]
      .toSorted(([left], [right]) => left - right)
      .flatMap(([status, schemas]) =>
        schemas.map((schema) => ({ status, ...Transport.normalizeTransport(schema, "error", endpoint, name) })),
      ),
  }
}

function assertUniqueInputs(input: Input, payload: Normalized | undefined, name: string) {
  const sources = new Map<string, Types.InputField["source"]>()
  for (const field of input) {
    const existing = sources.get(field.name)
    if (existing !== undefined) {
      if (field.source === "payload" && payload !== undefined && !SchemaShape.isFlattenableStruct(payload.schema)) {
        throw new Errors.GenerationError({
          reason: `Opaque payload field collision: ${name}.payload conflicts with ${existing}.${field.name}`,
        })
      }
      throw new Errors.GenerationError({ reason: `Input field collision: ${field.name}` })
    }
    sources.set(field.name, field.source)
  }
}

function assertPortable(transports: Transports, name: string, portable: Map<SchemaAST.AST, boolean>) {
  const effectPortable =
    [
      transports.params,
      transports.query,
      transports.headers,
      ...transports.payloads,
      transports.success,
      ...transports.errors,
    ].every((item) => item?.effectPortable !== false) && SchemaShape.streamEffectPortable(transports.success.schema)
  if (!effectPortable) return
  const schemaPaths: Array<readonly [string, Schema.Top]> = [
    ...(transports.params === undefined ? [] : [[`${name}.params`, transports.params.schema] as const]),
    ...(transports.query === undefined ? [] : [[`${name}.query`, transports.query.schema] as const]),
    ...(transports.headers === undefined ? [] : [[`${name}.headers`, transports.headers.schema] as const]),
    ...transports.payloads.map((item) => [`${name}.payload`, item.schema] as const),
    ...SchemaShape.responseSchemas(transports.success.schema, `${name}.success`),
    ...transports.errors.map((item) => [`${name}.error.${item.status}`, item.schema] as const),
  ]
  for (const [path, schema] of schemaPaths) Portable.assertPortable(schema, path, portable)
}

function buildOperation(
  groupName: string,
  clientPath: Types.Endpoint["clientPath"],
  input: Input,
  transports: Transports,
): Types.Operation {
  return {
    group: groupName,
    name: clientPath.join("."),
    input: input.map(({ name, source }) => ({ name, source })),
    inputMode: Operations.inputMode(input),
    success: SchemaShape.successKind(transports.success.schema),
    errors: [
      ...new Set([
        ...transports.errors.flatMap((item) => {
          const identifier = SchemaAST.resolveIdentifier(item.schema.ast)
          return identifier === undefined ? [] : [identifier]
        }),
        "ClientError",
      ]),
    ],
  }
}

export function buildEndpoint(source: Source, portable: Map<SchemaAST.AST, boolean>): Types.Endpoint {
  const endpoint = source.endpoint
  const group = source.group
  const name = `${group.identifier}.${endpoint.identifier}`
  const required = [...source.middleware].find((item) => item.requiredForClient)
  if (required !== undefined) {
    throw new Errors.GenerationError({ reason: `Client middleware requires adapter: ${required.key}` })
  }
  const transports = normalizeTransports(source, name)
  const input = [
    ...inputFields(transports.params?.schema, "params", name),
    ...inputFields(transports.query?.schema, "query", name),
    ...inputFields(transports.headers?.schema, "headers", name),
    ...transports.payloads.flatMap((item) => inputFields(item.schema, "payload", name)),
  ]
  assertUniqueInputs(input, transports.payloads[0], name)
  assertPortable(transports, name, portable)
  const clientPath = Names.clientEndpointPath(
    group.identifier,
    Context.getOrElse(endpoint.annotations, OpenApi.Identifier, () =>
      group.topLevel ? endpoint.identifier : `${group.identifier}.${endpoint.identifier}`,
    ),
  )
  return {
    group: group.identifier,
    topLevel: group.topLevel,
    endpoint,
    params: transports.params?.schema,
    query: transports.query?.schema,
    headers: transports.headers?.schema,
    payloads: transports.payloads.map((item) => item.schema),
    input,
    clientPath,
    unwrapData: SchemaShape.isDataEnvelope(transports.success.schema),
    successes: [transports.success.schema],
    successStatus: [...source.successes.keys()].at(0) ?? 200,
    errors: transports.errors.map((item) => ({ status: item.status, schema: item.schema })),
    operation: buildOperation(group.identifier, clientPath, input, transports),
  }
}
