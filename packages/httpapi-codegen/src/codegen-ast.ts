export * as CodegenAst from "./codegen-ast.js"

import { Array, Match, Record, Schema, SchemaAST, SchemaRepresentation } from "effect"
import { SchemaShape } from "./schema-shape.js"

type Recursive = SchemaAST.AST & { recur(recur: (ast: SchemaAST.AST) => SchemaAST.AST): unknown }

function isRecursive(ast: SchemaAST.AST): ast is Recursive {
  return "recur" in ast && typeof ast.recur === "function"
}

function mapChildren(ast: SchemaAST.AST, recur: (ast: SchemaAST.AST) => SchemaAST.AST): SchemaAST.AST {
  if (!isRecursive(ast)) return ast
  const next = ast.recur(recur)
  if (!SchemaAST.isAST(next)) throw new Error("Schema recursion produced a non-AST value")
  return next
}

export function jsonWireAst(ast: SchemaAST.AST): SchemaAST.AST {
  if (SchemaAST.isDeclaration(ast) && ast.annotations?.toCodecJson !== undefined) {
    return Schema.toEncoded(Schema.toCodecJson(Schema.make<Schema.Top>(ast))).ast
  }
  return mapChildren(ast, jsonWireAst)
}

function normalizeDeclaration(ast: SchemaAST.Declaration, recur: (ast: SchemaAST.AST) => SchemaAST.AST) {
  if (SchemaShape.isJsonRepresentation(ast.annotations?.representation)) return Schema.Json.ast
  const fields = ast.typeParameters[0]
  if (ast.annotations?.["~constructor"] === undefined || fields === undefined) return
  const identifier = SchemaAST.resolveIdentifier(ast)
  const recursed = recur(fields)
  if (identifier === undefined) return recursed
  return Schema.make<Schema.Top>(recursed).annotate({ identifier }).ast
}

const keywordWithoutChecks = <Keyword extends SchemaRepresentation.Representation>(keyword: Keyword) => ({
  ...keyword,
  checks: [],
})

function withoutChecks(representation: SchemaRepresentation.Representation): SchemaRepresentation.Representation {
  return Match.valueTags(representation, {
    Reference: (reference) => reference,
    Suspend: (suspend) => ({ ...suspend, thunk: withoutChecks(suspend.thunk) }),
    Declaration: (declaration) => ({
      ...declaration,
      checks: [],
      typeParameters: declaration.typeParameters.map(withoutChecks),
    }),
    TemplateLiteral: (template) => ({ ...template, checks: [], parts: template.parts.map(withoutChecks) }),
    Arrays: (arrays) => ({
      ...arrays,
      checks: [],
      elements: arrays.elements.map((element) => ({ ...element, type: withoutChecks(element.type) })),
      rest: arrays.rest.map(withoutChecks),
    }),
    Objects: (objects) => ({
      ...objects,
      checks: [],
      propertySignatures: objects.propertySignatures.map((property) => ({
        ...property,
        type: withoutChecks(property.type),
      })),
      indexSignatures: objects.indexSignatures.map((index) => ({
        parameter: withoutChecks(index.parameter),
        type: withoutChecks(index.type),
      })),
    }),
    Union: (union) => ({ ...union, checks: [], types: union.types.map(withoutChecks) }),
    Null: keywordWithoutChecks,
    Undefined: keywordWithoutChecks,
    Void: keywordWithoutChecks,
    Never: keywordWithoutChecks,
    Unknown: keywordWithoutChecks,
    Any: keywordWithoutChecks,
    String: keywordWithoutChecks,
    Number: keywordWithoutChecks,
    Boolean: keywordWithoutChecks,
    BigInt: keywordWithoutChecks,
    Symbol: keywordWithoutChecks,
    Literal: keywordWithoutChecks,
    UniqueSymbol: keywordWithoutChecks,
    ObjectKeyword: keywordWithoutChecks,
    Enum: keywordWithoutChecks,
  })
}

function codegenAsts(roots: ReadonlyArray<SchemaAST.AST>) {
  const cache = new WeakMap<SchemaAST.AST, SchemaAST.AST>()
  const references = new Map<string, SchemaAST.AST>()
  const recur = (ast: SchemaAST.AST): SchemaAST.AST => {
    const cached = cache.get(ast)
    if (cached !== undefined) return cached
    const identifier = SchemaAST.resolveIdentifier(ast)
    const output = normalize(ast)
    if (identifier === undefined) {
      cache.set(ast, output)
      return output
    }
    const document = SchemaRepresentation.toRepresentation(output)
    const encoding = JSON.stringify(
      SchemaRepresentation.toJson({
        representation: withoutChecks(document.representation),
        references: Record.map(document.references, withoutChecks),
      }),
    )
    const referenceKey = `${identifier}\0${ast.context?.isOptional === true}\0${ast.context?.isMutable === true}\0${encoding}`
    const reference = references.get(referenceKey) ?? output
    cache.set(ast, reference)
    references.set(referenceKey, reference)
    return reference
  }
  const normalize = (ast: SchemaAST.AST): SchemaAST.AST => {
    const declared =
      SchemaAST.isDeclaration(ast) && ast.annotations?.toCode === undefined
        ? normalizeDeclaration(ast, recur)
        : undefined
    return declared ?? mapChildren(ast, recur)
  }
  return roots.map(recur)
}

export function codegenRepresentations(roots: ReadonlyArray<SchemaAST.AST>) {
  const asts = codegenAsts(roots)
  const first = asts[0]
  if (first === undefined) throw new Error("Codegen produced no AST")
  const document = SchemaRepresentation.toRepresentations([first, ...asts.slice(1)])
  return {
    representations: Array.map(document.representations, withoutChecks),
    references: Record.map(document.references, withoutChecks),
  }
}
