export * as Portable from "./portable.js"

import { Schema, SchemaAST } from "effect"
import { Errors } from "./errors.js"
import { SchemaShape } from "./schema-shape.js"

const ignoredAnnotations = new Set([
  "toCodec",
  "toCodecJson",
  "toCodecStringTree",
  "toCodecArbitrary",
  "toArbitrary",
  "toFormatter",
  "toEquivalence",
  "toCode",
  "~constructor",
])

function serializable(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(serializable)
  if (typeof value !== "object") return false
  return Object.values(value).every(serializable)
}

function annotationsPortable(annotations: Schema.Annotations.Annotations | undefined) {
  if (annotations === undefined) return true
  return Object.entries(annotations).every(([key, value]) => ignoredAnnotations.has(key) || serializable(value))
}

function checksPortable(checks: SchemaAST.Checks | undefined): boolean {
  if (checks === undefined) return true
  return checks.every((check) =>
    check._tag === "Filter"
      ? !check.aborted &&
        check.annotations?.representation !== undefined &&
        serializable(check.annotations.representation) &&
        typeof check.annotations.arbitraryConstraint === "object"
      : checksPortable(check.checks),
  )
}

function ownMetadataPortable(ast: SchemaAST.AST) {
  return (
    annotationsPortable(ast.annotations) &&
    checksPortable(ast.checks) &&
    !("encodingChecks" in ast && !checksPortable(ast.encodingChecks))
  )
}

function children(ast: SchemaAST.AST): ReadonlyArray<SchemaAST.AST> {
  if (SchemaAST.isDeclaration(ast)) return ast.typeParameters
  if (SchemaAST.isSuspend(ast)) return [ast.thunk()]
  if (SchemaAST.isUnion(ast)) return ast.types
  if (SchemaAST.isArrays(ast)) return [...ast.elements, ...ast.rest]
  if (SchemaAST.isObjects(ast)) {
    return [
      ...ast.propertySignatures.map((field) => field.type),
      ...ast.indexSignatures.flatMap((field) => [field.parameter, field.type]),
    ]
  }
  return []
}

export function metadataPortable(ast: SchemaAST.AST, seen: Set<SchemaAST.AST>): boolean {
  if (seen.has(ast)) return true
  seen.add(ast)
  if (!ownMetadataPortable(ast)) return false
  if (ast.encoding?.some((link) => !metadataPortable(link.to, seen))) return false
  return children(ast).every((item) => metadataPortable(item, seen))
}

function supportedDeclaration(ast: SchemaAST.Declaration) {
  return (
    typeof ast.annotations?.toCode === "function" ||
    SchemaShape.isJsonRepresentation(ast.annotations?.representation) ||
    (ast.annotations?.["~constructor"] !== undefined && ast.typeParameters[0] !== undefined)
  )
}

function taggedErrorPortable(ast: SchemaAST.Declaration, visit: (ast: SchemaAST.AST) => boolean) {
  return (
    ast.checks === undefined &&
    !("encodingChecks" in ast && !checksPortable(ast.encodingChecks)) &&
    !ast.typeParameters.some((parameter) => parameter.checks !== undefined) &&
    ast.typeParameters.every(visit)
  )
}

export function assertPortable(schema: Schema.Top, path: string, portable: Map<SchemaAST.AST, boolean>) {
  const visiting = new Set<SchemaAST.AST>()
  const visit = (ast: SchemaAST.AST): boolean => {
    const cached = portable.get(ast)
    if (cached !== undefined) return cached
    if (visiting.has(ast)) return true
    visiting.add(ast)
    const result = visitCurrent(ast)
    visiting.delete(ast)
    portable.set(ast, result)
    return result
  }
  const visitCurrent = (ast: SchemaAST.AST): boolean => {
    if (!ownMetadataPortable(ast)) return false
    if (SchemaAST.isDeclaration(ast)) return supportedDeclaration(ast) && ast.typeParameters.every(visit)
    if (ast.encoding !== undefined && ast.annotations?.toCode === undefined) return false
    return (SchemaAST.isTemplateLiteral(ast) ? ast.parts : children(ast)).every(visit)
  }
  const portableSchema =
    SchemaShape.taggedErrorFields(schema) !== undefined && SchemaAST.isDeclaration(schema.ast)
      ? taggedErrorPortable(schema.ast, visit)
      : visit(schema.ast)
  if (!portableSchema) throw new Errors.GenerationError({ reason: `Unportable schema: ${path}` })
}
