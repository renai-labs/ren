export * as EmitEffectShape from "./emit-effect-shape.js"

import { Schema, SchemaAST, SchemaRepresentation } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { ClientTree } from "./client-tree.js"
import { CodegenAst } from "./codegen-ast.js"
import { Errors } from "./errors.js"
import { Names } from "./names.js"
import { Operations } from "./operations.js"
import { SchemaShape } from "./schema-shape.js"
import { TypeText } from "./type-text.js"
import type { Types } from "./types.js"

type ResolvedTypeReference = Omit<Types.EffectTypeReference, "schema"> & {
  readonly ast: SchemaAST.AST
  readonly type: string | undefined
}

type Options = {
  readonly typeReferences?: ReadonlyArray<Types.EffectTypeReference>
  readonly outputTypes?: Readonly<Record<string, Types.EffectOutputType>>
}

type TypeReferences = ReturnType<typeof effectTypeReferences>

const leadingIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*/

function effectTypeReferences(input: ReadonlyArray<Types.EffectTypeReference>) {
  const names = new Map<string, ResolvedTypeReference>()
  const asts = new Map<SchemaAST.AST, ResolvedTypeReference>()
  for (const reference of input) {
    if (SchemaAST.resolveIdentifier(reference.schema.ast) === undefined) continue
    const projected = Schema.toType(reference.schema)
    const document = SchemaRepresentation.toCodeDocument(CodegenAst.codegenRepresentations([projected.ast]))
    const name = document.codes[0]?.Type
    const type =
      name === undefined ? undefined : document.references.nonRecursives.find((item) => item.$ref === name)?.code.Type
    const value = { name: reference.name, import: reference.import, ast: reference.schema.ast, type }
    asts.set(reference.schema.ast, value)
    asts.set(projected.ast, value)
    if (name === undefined || type === undefined || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue
    const previous = names.get(name)
    if (previous === undefined) {
      names.set(name, value)
      continue
    }
    if (previous.ast !== reference.schema.ast) {
      throw new Errors.GenerationError({ reason: `Conflicting Effect type reference: ${name}` })
    }
  }
  return { names, asts }
}

function effectType(schema: Schema.Top, references: TypeReferences, imports: Set<string>) {
  const projected = Schema.toType(schema)
  const direct = references.asts.get(schema.ast) ?? references.asts.get(projected.ast)
  if (direct !== undefined) {
    imports.add(direct.import)
    return direct.name
  }
  const document = SchemaRepresentation.toCodeDocument(CodegenAst.codegenRepresentations([projected.ast]))
  const source = new Map(document.references.nonRecursives.map((reference) => [reference.$ref, reference.code.Type]))
  const expand = (type: string, seen = new Set<string>()): string =>
    [...source].reduce((result, [name, value]) => {
      if (!TypeText.mentionsReference(result, name)) return result
      // oxlint-disable-next-line ren/no-comments -- Optional/encoded occurrences can acquire a numeric suffix; reuse the named type only when its definition matches, since a suffix can also denote a different shape.
      const candidate = references.names.get(name.replace(/_\d+$/, ""))
      const reference = references.names.get(name) ?? (candidate?.type === value ? candidate : undefined)
      if (reference !== undefined) {
        imports.add(reference.import)
        return TypeText.replaceReference(result, name, reference.name)
      }
      if (seen.has(name)) return result
      return TypeText.replaceReference(result, name, `(${expand(value, new Set([...seen, name]))})`)
    }, type)
  const code = document.codes[0]
  if (code === undefined) throw new Error("Codegen produced no type")
  const type = expand(code.Type)
  if (type.includes("DateTime.")) imports.add('import type { DateTime } from "effect"')
  if (type.includes("Schema.")) imports.add('import type { Schema } from "effect"')
  return type
}

function effectInputSchema(endpoint: Types.Endpoint, field: Types.InputField): Schema.Top | undefined {
  const schema = {
    params: endpoint.params,
    query: endpoint.query,
    headers: endpoint.headers,
    payload: endpoint.payloads[0],
  }[field.source]
  if (schema === undefined) return undefined
  if (SchemaShape.isOpaquePayload(endpoint) && field.source === "payload") return schema
  const ast = Schema.toType(schema).ast
  if (!SchemaAST.isObjects(ast)) return undefined
  const property = ast.propertySignatures.find((item) => item.name === field.name)
  return property === undefined ? undefined : Schema.make<Schema.Top>(property.type)
}

function effectOutputSchema(endpoint: Types.Endpoint): Schema.Top | undefined {
  const schema = endpoint.successes[0]
  if (HttpApiSchema.isNoContent(schema.ast)) return undefined
  if (SchemaShape.isStreamSchema(schema)) {
    return schema._tag === "StreamUint8Array" ? Schema.Uint8Array : SchemaShape.streamEventSchema(schema)
  }
  if (!endpoint.unwrapData) return schema
  const ast = Schema.toType(schema).ast
  if (!SchemaAST.isObjects(ast)) return undefined
  const data = ast.propertySignatures.find((property) => property.name === "data")
  return data === undefined ? undefined : Schema.make<Schema.Top>(data.type)
}

function assertNoNameCollision(groups: ReadonlyArray<Types.Group>, options: Options) {
  const externalNames = new Set([
    "AppApi",
    "Effect",
    "Stream",
    ...(options.typeReferences ?? []).flatMap((reference) => reference.name.match(leadingIdentifier) ?? []),
    ...Object.values(options.outputTypes ?? {}).flatMap((output) => output.name.match(leadingIdentifier) ?? []),
  ])
  const generatedNames = groups.flatMap((group) => [
    Names.groupShapeName(group),
    ...group.endpoints.flatMap((endpoint) => [
      ...(endpoint.operation.inputMode === "none" ? [] : [`${Names.endpointTypeName(group, endpoint)}Input`]),
      `${Names.endpointTypeName(group, endpoint)}Output`,
      Names.groupShapeTypeName(group, endpoint),
    ]),
  ])
  const collision = generatedNames.find((name) => externalNames.has(name))
  if (collision !== undefined) {
    throw new Errors.GenerationError({ reason: `Generated Effect type collides with imported type: ${collision}` })
  }
}

function renderEndpointShape(
  group: Types.Group,
  endpoint: Types.Endpoint,
  references: TypeReferences,
  imports: Set<string>,
  options: Options,
) {
  const prefix = Names.endpointTypeName(group, endpoint)
  const inputMode = endpoint.operation.inputMode
  const input = endpoint.input
    .map((field) => {
      const schema = effectInputSchema(endpoint, field)
      if (schema === undefined) {
        throw new Errors.GenerationError({
          reason: `Missing Effect input schema: ${endpoint.group}.${endpoint.endpoint.identifier}.${field.name}`,
        })
      }
      return `readonly ${JSON.stringify(field.name)}${field.optional ? "?" : ""}: ${effectType(schema, references, imports)}`
    })
    .join("; ")
  const output = effectOutputSchema(endpoint)
  const override = options.outputTypes?.[Names.clientOperationKey(group, endpoint)]
  if (override !== undefined) imports.add(override.import)
  const outputName = override?.name ?? (output === undefined ? "void" : effectType(output, references, imports))
  const result = endpoint.operation.success === "stream" ? "Stream.Stream" : "Effect.Effect"
  const argument = inputMode === "none" ? "" : `input${inputMode === "optional" ? "?" : ""}: ${prefix}Input`
  return [
    inputMode === "none" ? "" : `export type ${prefix}Input = { ${input} }`,
    `export type ${prefix}Output = ${outputName}`,
    `export type ${Names.groupShapeTypeName(group, endpoint)}<E = never> = (${argument}) => ${result}<${prefix}Output, E>`,
  ]
    .filter(Boolean)
    .join("\n")
}

function renderShapeMethods(group: Types.Group) {
  return ClientTree.renderClientTree(
    group.endpoints,
    (endpoint) => `${Names.groupShapeTypeName(group, endpoint)}<E>`,
    (name, value) => `readonly ${JSON.stringify(name)}: ${value}`,
    "\n",
  )
}

function renderEffectShape(groups: ReadonlyArray<Types.Group>, options: Options) {
  const references = effectTypeReferences(options.typeReferences ?? [])
  assertNoNameCollision(groups, options)
  const imports = new Set<string>()
  const endpointTypes = groups.map((group) => {
    const endpoints = group.endpoints.map((endpoint) =>
      renderEndpointShape(group, endpoint, references, imports, options),
    )
    return `${endpoints.join("\n\n")}\n\nexport interface ${Names.groupShapeName(group)}<E = never> {\n${renderShapeMethods(group)}\n}`
  })
  const clientFields = groups.map((group) =>
    group.endpoints[0]?.topLevel
      ? renderShapeMethods(group)
      : `readonly ${JSON.stringify(group.identifier)}: ${Names.groupShapeName(group)}<E>`,
  )
  return `// Generated by @ren/httpapi-codegen. Do not edit.
import type { Effect, Stream } from "effect"
${[...imports].join("\n")}

${endpointTypes.join("\n\n")}

export interface AppApi<E = never> {
${clientFields.join("\n")}
}
`
}

export function emitEffectShape(contract: Types.Contract, options?: Options): Types.Output {
  return {
    operations: Operations.operations(contract.groups),
    files: [{ path: "api.ts", content: renderEffectShape(contract.groups, options ?? {}) }],
  }
}
