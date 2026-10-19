export * as PromiseTypes from "./promise-types.js"

import { Schema, SchemaAST, SchemaRepresentation } from "effect"
import { CodegenAst } from "./codegen-ast.js"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import { SchemaShape } from "./schema-shape.js"
import { TypeText } from "./type-text.js"
import type { Types } from "./types.js"

type TypeOf = (schema: Schema.Top, options?: { readonly decoded: boolean }) => string
type CodeDocument = ReturnType<typeof SchemaRepresentation.toCodeDocument>

function assertNoReferencedTypes(document: CodeDocument) {
  if (document.artifacts.length > 0 || Object.keys(document.references.recursives).length > 0) {
    throw new Errors.GenerationError({ reason: "Referenced Promise types are not implemented" })
  }
}

function inlineReferences(references: ReadonlyMap<string, string>, type: string, seen = new Set<string>()): string {
  return [...references].reduce((result, [reference, value]) => {
    if (!TypeText.mentionsReference(result, reference)) return result
    if (seen.has(reference)) {
      throw new Errors.GenerationError({ reason: `Recursive Promise types are not implemented: ${reference}` })
    }
    return TypeText.replaceReference(
      result,
      reference,
      `(${inlineReferences(references, value, new Set([...seen, reference]))})`,
    )
  }, type)
}

function structuralType(schema: Schema.Top) {
  const document = SchemaRepresentation.toCodeDocument(
    CodegenAst.codegenRepresentations([CodegenAst.jsonWireAst(schema.ast)]),
  )
  assertNoReferencedTypes(document)
  const references = new Map(
    document.references.nonRecursives.map((reference) => [reference.$ref, reference.code.Type]),
  )
  const code = document.codes[0]
  if (code === undefined) throw new Error("Codegen produced no type")
  return TypeText.preserveStringSuggestions(
    inlineReferences(references, code.Type).replaceAll("Schema.Json", "JsonValue"),
  )
}

function structuralTypes(
  schemas: ReadonlyArray<Schema.Top>,
  options: { readonly mutable: boolean; readonly reservedNames: ReadonlySet<string> },
) {
  if (schemas.length === 0) return { types: [], definitions: [] }
  const representations = CodegenAst.codegenRepresentations(schemas.map((schema) => CodegenAst.jsonWireAst(schema.ast)))
  const document = SchemaRepresentation.toCodeDocument(representations)
  assertNoReferencedTypes(document)
  const anonymous = new Set(
    Object.entries(representations.references)
      .filter(([, reference]) => {
        if (!("annotations" in reference) || reference.annotations === undefined) return true
        return reference.annotations.identifier === undefined && reference.annotations["~identifier"] === undefined
      })
      .map(([name]) => name),
  )
  const anonymousTypes = new Map(
    document.references.nonRecursives
      .filter((reference) => anonymous.has(reference.$ref))
      .map((reference) => [reference.$ref, reference.code.Type]),
  )
  const names = new Map<string, string>()
  const usedNames = new Set(options.reservedNames)
  const references = document.references.nonRecursives.filter((reference) => !anonymous.has(reference.$ref))
  const referenceNames = new Set(references.map((reference) => reference.$ref))
  for (const reference of references) {
    const name = Names.uniqueTypeName(Names.identifierPart(reference.$ref), usedNames)
    names.set(reference.$ref, name)
    usedNames.add(name)
  }
  const render = (type: string) => {
    const named = [...names].reduce(
      (result, [reference, name]) => TypeText.replaceReference(result, reference, name),
      type,
    )
    const output = named.replaceAll("Schema.Json", "JsonValue").replaceAll(/(?<!["'])\bunknown\b(?!["'])/g, "any")
    const suggested = TypeText.preserveStringSuggestions(output)
    return options.mutable
      ? suggested.replaceAll("ReadonlyArray<", "Array<").replaceAll(/\breadonly\s+/g, "")
      : suggested
  }
  const equivalent = new Map<string, string>()
  for (const reference of references) {
    const base = Names.withoutNumericSuffix(reference.$ref)
    const identifier = referenceNames.has(base) ? base : reference.$ref
    const key = `${identifier}\0${render(inlineReferences(anonymousTypes, reference.code.Type))}`
    const existing = equivalent.get(key)
    const name = names.get(reference.$ref)
    if (name === undefined) throw new Errors.GenerationError({ reason: `Missing Promise type name: ${reference.$ref}` })
    if (existing === undefined) equivalent.set(key, name)
    else names.set(reference.$ref, existing)
  }
  const emitted = new Set<string>()
  return {
    types: document.codes.map((code) => render(inlineReferences(anonymousTypes, code.Type))),
    definitions: references.flatMap((reference) => {
      const name = names.get(reference.$ref)
      if (name === undefined)
        throw new Errors.GenerationError({ reason: `Missing Promise type name: ${reference.$ref}` })
      if (emitted.has(name)) return []
      emitted.add(name)
      return [`export type ${name} = ${render(inlineReferences(anonymousTypes, reference.code.Type))}`]
    }),
  }
}

function promiseSuccessSchema(schema: Schema.Top) {
  if (!SchemaShape.isStreamSchema(schema) || schema._tag !== "StreamSse") return schema
  return schema.sseMode === "data"
    ? SchemaShape.streamEncodedDataSchema(schema)
    : Schema.make<Schema.Top>(schema.events.ast)
}

function renderEndpointTypes(
  group: Types.Group,
  endpoint: Types.Endpoint,
  typeOf: TypeOf,
  outputTypeOf: (schema: Schema.Top) => string,
) {
  const prefix = Names.promiseTypePrefix(group.identifier, endpoint.clientPath)
  const schemas = {
    params: endpoint.params,
    query: endpoint.query,
    headers: endpoint.headers,
    payload: endpoint.payloads[0],
  }
  const input = Operations.promiseInput(endpoint)
    .map((field) => {
      if (field.source === "wildcard") return `readonly ${JSON.stringify(field.name)}: string`
      const schema = schemas[field.source]
      if (schema === undefined)
        throw new Errors.GenerationError({ reason: `Missing input schema: ${prefix}.${field.name}` })
      const type =
        SchemaShape.isOpaquePayload(endpoint) && field.source === "payload"
          ? typeOf(schema)
          : `(${typeOf(schema, { decoded: field.source === "query" })})[${JSON.stringify(field.name)}]`
      return `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${type}`
    })
    .join("; ")
  const success = outputTypeOf(promiseSuccessSchema(endpoint.successes[0]))
  return [
    ...(Operations.promiseInputMode(endpoint) === "none" ? [] : [`export type ${prefix}Input = { ${input} }`]),
    `export type ${prefix}Output = ${endpoint.unwrapData ? `(${success})["data"]` : success}`,
  ]
}

function renderErrorType(error: NonNullable<ReturnType<typeof SchemaShape.declaredErrorFields>>, typeOf: TypeOf) {
  const fields = error.fields
    .map(([name, schema, optional]) => `readonly ${JSON.stringify(name)}${optional ? "?" : ""}: ${typeOf(schema)}`)
    .join("; ")
  return `export type ${error.identifier} = { readonly ${JSON.stringify(error.key)}: ${JSON.stringify(error.tag)}; ${fields} }\nexport const is${error.identifier} = (value: unknown): value is ${error.identifier} => typeof value === "object" && value !== null && ${JSON.stringify(error.key)} in value && value[${JSON.stringify(error.key)}] === ${JSON.stringify(error.tag)}`
}

export function renderPromiseTypes(groups: ReadonlyArray<Types.Group>, options: { readonly mutableOutputs: boolean }) {
  const types = new Map<SchemaAST.AST, string>()
  const typeOf: TypeOf = (schema, typeOptions) => {
    const projected = typeOptions?.decoded ? Schema.toType(schema) : Schema.toEncoded(schema)
    const cached = types.get(projected.ast)
    if (cached !== undefined) return cached
    const type = structuralType(projected)
    types.set(projected.ast, type)
    return type
  }
  const outputMarkers = new Map<SchemaAST.AST, string>()
  const outputSchemas: Array<Schema.Top> = []
  const outputTypeOf = (schema: Schema.Top) => {
    const projected = Schema.toEncoded(schema)
    const cached = outputMarkers.get(projected.ast)
    if (cached !== undefined) return cached
    const marker = `__PROMISE_TYPE_${outputSchemas.length}__`
    outputSchemas.push(projected)
    outputMarkers.set(projected.ast, marker)
    return marker
  }
  const errors = new Map(
    groups.flatMap((group) =>
      group.endpoints.flatMap((endpoint) =>
        endpoint.errors.flatMap((error) => {
          const tagged = SchemaShape.declaredErrorFields(error.schema)
          return tagged === undefined ? [] : [[tagged.tag, tagged] as const]
        }),
      ),
    ),
  )
  const errorTypes = [...errors.values()].map((error) => renderErrorType(error, typeOf))
  const operations = groups
    .flatMap((group) =>
      group.endpoints.flatMap((endpoint) => renderEndpointTypes(group, endpoint, typeOf, outputTypeOf)),
    )
    .join("\n\n")
  const reservedNames = new Set([
    "ClientError",
    "JsonValue",
    ...errors.keys(),
    ...groups.flatMap((group) =>
      group.endpoints.flatMap((endpoint) => {
        const prefix = Names.promiseTypePrefix(group.identifier, endpoint.clientPath)
        return [`${prefix}Input`, `${prefix}Output`]
      }),
    ),
  ])
  const rendered = structuralTypes(outputSchemas, { mutable: options.mutableOutputs, reservedNames })
  const resolve = (source: string) =>
    rendered.types.reduce((result, type, index) => result.replaceAll(`__PROMISE_TYPE_${index}__`, type), source)
  const resolvedErrors = errorTypes.map(resolve)
  const resolvedOperations = resolve(operations)
  const json = [...rendered.definitions, ...resolvedErrors, resolvedOperations].some((type) =>
    type.includes("JsonValue"),
  )
    ? `export type JsonValue = null | boolean | number | string | ${options.mutableOutputs ? "Array<JsonValue> | { [key: string]: JsonValue }" : "ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue }"}`
    : ""
  return [json, ...rendered.definitions, ...resolvedErrors, resolvedOperations].filter(Boolean).join("\n\n")
}
