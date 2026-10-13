export * as Encoding from "./encoding.js"

import { SchemaAST, SchemaRepresentation } from "effect"

const encodings = new WeakMap<SchemaAST.AST, string>()

export function representationEncoding(ast: SchemaAST.AST) {
  const cached = encodings.get(ast)
  if (cached !== undefined) return cached
  const encoded = JSON.stringify(SchemaRepresentation.toJson(SchemaRepresentation.toRepresentation(ast)))
  encodings.set(ast, encoded)
  return encoded
}

export function sameEncoding(left: SchemaAST.AST, right: SchemaAST.AST): boolean {
  return sameRuntimeEncoding(left, right) && representationEncoding(left) === representationEncoding(right)
}

function sameAsts(left: ReadonlyArray<SchemaAST.AST>, right: ReadonlyArray<SchemaAST.AST>) {
  return (
    left.length === right.length &&
    left.every((ast, index) => {
      const other = right[index]
      return other !== undefined && sameRuntimeEncoding(ast, other)
    })
  )
}

function sameChildren(left: SchemaAST.AST, right: SchemaAST.AST): boolean {
  if (SchemaAST.isSuspend(left) && SchemaAST.isSuspend(right)) return sameRuntimeEncoding(left.thunk(), right.thunk())
  if (SchemaAST.isUnion(left) && SchemaAST.isUnion(right)) return sameAsts(left.types, right.types)
  if (SchemaAST.isArrays(left) && SchemaAST.isArrays(right)) {
    return sameAsts(left.elements, right.elements) && sameAsts(left.rest, right.rest)
  }
  if (SchemaAST.isObjects(left) && SchemaAST.isObjects(right)) {
    return (
      sameAsts(
        left.propertySignatures.map((field) => field.type),
        right.propertySignatures.map((field) => field.type),
      ) &&
      sameAsts(
        left.indexSignatures.flatMap((field) => [field.parameter, field.type]),
        right.indexSignatures.flatMap((field) => [field.parameter, field.type]),
      )
    )
  }
  return true
}

function sameRuntimeEncoding(left: SchemaAST.AST, right: SchemaAST.AST): boolean {
  if (left._tag !== right._tag) return false
  const leftLinks = left.encoding?.map((link) => link.to) ?? []
  const rightLinks = right.encoding?.map((link) => link.to) ?? []
  if (!sameAsts(leftLinks, rightLinks)) return false
  if (!sameChecks(left.checks, right.checks) || !sameContext(left.context, right.context)) return false
  return sameChildren(left, right)
}

function sameChecks(left: SchemaAST.Checks | undefined, right: SchemaAST.Checks | undefined): boolean {
  if (left?.length !== right?.length) return false
  if (left === undefined || right === undefined) return true
  return left.every((check, index) => {
    const other = right[index]
    if (other === undefined || check._tag !== other._tag) return false
    if (check._tag === "Filter" && other._tag === "Filter") {
      return check.run === other.run && check.aborted === other.aborted
    }
    return check._tag === "FilterGroup" && other._tag === "FilterGroup" && sameChecks(check.checks, other.checks)
  })
}

function sameContext(left: SchemaAST.Context | undefined, right: SchemaAST.Context | undefined) {
  return left?.isOptional === right?.isOptional && left?.isMutable === right?.isMutable
}
