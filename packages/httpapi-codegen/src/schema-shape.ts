export * as SchemaShape from "./schema-shape.js"

import { Schema, SchemaAST } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { Encoding } from "./encoding.js"
import { Errors } from "./errors.js"
import type { Types } from "./types.js"

export const resolveHttpApiStatus = SchemaAST.resolveAt<number>("httpApiStatus")
export const resolveHttpApiEncoding = SchemaAST.resolveAt<HttpApiSchema.Encoding>("~httpApiEncoding")

type SseSchema = Extract<HttpApiSchema.StreamSchema, { readonly _tag: "StreamSse" }>

export function isStreamSchema(schema: Schema.Top): schema is HttpApiSchema.StreamSchema {
  return "_tag" in schema && (schema._tag === "StreamSse" || schema._tag === "StreamUint8Array")
}

export function isFlattenableStruct(schema: Schema.Top) {
  const ast = Schema.toType(schema).ast
  return SchemaAST.isObjects(ast) && ast.indexSignatures.length === 0
}

export function isOpaquePayload(endpoint: Types.Endpoint) {
  const payload = endpoint.payloads[0]
  return payload !== undefined && !isFlattenableStruct(payload)
}

export function isBinarySchema(schema: Schema.Top) {
  return (resolveHttpApiEncoding(schema.ast)?._tag ?? "Json") === "Uint8Array"
}

export function isBinaryPayload(endpoint: Types.Endpoint) {
  const payload = endpoint.payloads[0]
  return payload !== undefined && resolveHttpApiEncoding(payload.ast)?._tag === "Uint8Array"
}

export function isDataEnvelope(schema: Schema.Top) {
  if (isStreamSchema(schema) || HttpApiSchema.isNoContent(schema.ast)) return false
  const ast = Schema.toType(schema).ast
  return (
    SchemaAST.isObjects(ast) &&
    ast.indexSignatures.length === 0 &&
    ast.propertySignatures.length === 1 &&
    ast.propertySignatures[0]?.name === "data"
  )
}

export function isJsonRepresentation(representation: unknown) {
  return (
    typeof representation === "object" &&
    representation !== null &&
    "id" in representation &&
    representation.id === "effect/schema/Json"
  )
}

export function successKind(schema: Schema.Top): Types.Operation["success"] {
  if (isStreamSchema(schema)) return "stream"
  return HttpApiSchema.isNoContent(schema.ast) ? "void" : "value"
}

function streamDataAst(ast: SchemaAST.AST) {
  const data = SchemaAST.isObjects(ast)
    ? ast.propertySignatures.find((field) => field.name === "data")?.type
    : undefined
  if (data === undefined) throw new Errors.GenerationError({ reason: "Invalid SSE data schema" })
  return data
}

function streamDataSchema(schema: SseSchema) {
  return Schema.make<Schema.Top>(streamDataAst(Schema.toType(schema.events).ast))
}

type ReplaceEncoding = (ast: SchemaAST.AST, encoding: undefined) => unknown

function isReplaceEncoding(value: unknown): value is ReplaceEncoding {
  return typeof value === "function"
}

export function streamEncodedDataSchema(schema: SseSchema) {
  // oxlint-disable-next-line no-restricted-globals -- Effect exposes this runtime helper without a public type.
  const replaceEncoding: unknown = Reflect.get(SchemaAST, "replaceEncoding")
  if (!isReplaceEncoding(replaceEncoding)) throw new Errors.GenerationError({ reason: "Invalid SSE data schema" })
  const ast = replaceEncoding(streamDataAst(schema.events.ast), undefined)
  if (!SchemaAST.isAST(ast)) throw new Errors.GenerationError({ reason: "Invalid SSE data schema" })
  return Schema.toEncoded(Schema.make<Schema.Top>(ast))
}

export function streamEventSchema(schema: SseSchema) {
  return schema.sseMode === "data" ? streamDataSchema(schema) : Schema.make<Schema.Top>(schema.events.ast)
}

export function streamEffectPortable(schema: Schema.Top) {
  if (!isStreamSchema(schema) || schema._tag === "StreamUint8Array" || schema.sseMode === "events") return true
  const rebuilt = HttpApiSchema.StreamSse({
    data: streamDataSchema(schema),
    error: schema.error,
    contentType: schema.contentType,
  })
  return Encoding.sameEncoding(schema.events.ast, rebuilt.events.ast)
}

export function responseSchemas(schema: Schema.Top, path: string): Array<readonly [string, Schema.Top]> {
  if (HttpApiSchema.isNoContent(schema.ast)) return []
  if (!isStreamSchema(schema)) return [[path, schema]]
  if (schema._tag === "StreamUint8Array") return []
  return [
    [`${path}.${schema.sseMode}`, streamEventSchema(schema)],
    [`${path}.error`, schema.error],
  ]
}

function declarationFields(schema: Schema.Top) {
  const ast = schema.ast
  if (!SchemaAST.isDeclaration(ast) || ast.annotations?.["~constructor"] === undefined) return
  const fields = ast.typeParameters[0]
  if (fields === undefined || !SchemaAST.isObjects(fields) || fields.indexSignatures.length > 0) return
  return { ast, fields }
}

export function declaredErrorFields(schema: Schema.Top) {
  const declaration = declarationFields(schema)
  if (declaration === undefined) return
  const keyed = declaration.fields.propertySignatures.find((field) => field.name === "_tag" || field.name === "name")
  const key = keyed?.name
  if (keyed === undefined || (key !== "_tag" && key !== "name")) return
  const tag = keyed.type
  if (!SchemaAST.isLiteral(tag) || typeof tag.literal !== "string") return
  return {
    key,
    tag: tag.literal,
    identifier: SchemaAST.resolveIdentifier(declaration.ast) ?? tag.literal,
    fields: declaration.fields.propertySignatures.flatMap((field) =>
      field.name === key || typeof field.name !== "string"
        ? []
        : [[field.name, Schema.make<Schema.Top>(field.type), SchemaAST.isOptional(field.type)] as const],
    ),
  }
}

export function taggedErrorFields(schema: Schema.Top) {
  const fields = declaredErrorFields(schema)
  return fields?.key === "_tag" ? fields : undefined
}
