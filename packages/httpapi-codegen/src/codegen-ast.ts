export * as CodegenAst from "./codegen-ast.js"

import { Schema, SchemaAST, SchemaRepresentation } from "effect"
import { Encoding } from "./encoding.js"
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

function codegenAsts(roots: ReadonlyArray<SchemaAST.AST>) {
  const cache = new WeakMap<SchemaAST.AST, SchemaAST.AST>()
  const references = new Map<string, SchemaAST.AST>()
  const recur = (ast: SchemaAST.AST): SchemaAST.AST => {
    const cached = cache.get(ast)
    if (cached !== undefined) return cached
    const identifier = SchemaAST.resolveIdentifier(ast)
    const output = normalize(ast)
    const referenceKey =
      identifier === undefined
        ? undefined
        : `${identifier}\0${ast.context?.isOptional === true}\0${ast.context?.isMutable === true}\0${Encoding.representationEncoding(output)}`
    const reference = referenceKey === undefined ? undefined : references.get(referenceKey)
    if (reference !== undefined) {
      cache.set(ast, reference)
      return reference
    }
    cache.set(ast, output)
    if (referenceKey !== undefined) references.set(referenceKey, output)
    return output
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
  return SchemaRepresentation.toRepresentations([first, ...asts.slice(1)])
}
