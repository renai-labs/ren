import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const LOOKUPS = new Set(["find", "findIndex", "findLast", "findLastIndex"])
const ITERATIONS = new Set(["map", "flatMap", "filter", "forEach", "some", "every", "reduce", "find", "findIndex"])

const methodName = (node: ESTree.Node) =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  node.callee.property.type === "Identifier"
    ? node.callee.property.name
    : undefined

const rootName = (node: ESTree.Node): string | undefined => {
  if (node.type === "Identifier") return node.name
  if (node.type === "MemberExpression") return rootName(node.object)
  return undefined
}

const enclosingFunction = (node: ESTree.Node): ESTree.ArrowFunctionExpression | ESTree.Function | undefined => {
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return node
  if (node.type === "Program") return undefined
  return enclosingFunction(node.parent)
}

const bindings = (node: ESTree.Node): string[] => {
  if (node.type === "Identifier") return [node.name]
  if (node.type === "ObjectPattern")
    return node.properties.flatMap((property) =>
      property.type === "RestElement" ? bindings(property.argument) : bindings(property.value),
    )
  if (node.type === "ArrayPattern")
    return node.elements.flatMap((element) => (element === null ? [] : bindings(element)))
  if (node.type === "AssignmentPattern") return bindings(node.left)
  if (node.type === "RestElement") return bindings(node.argument)
  return []
}

export const noLookupInLoop = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow linear lookups on an outer array inside an iteration callback." },
    messages: {
      lookup:
        "`{{lookup}}` inside `{{loop}}` makes this O(n·m). Build a Map or Set once outside the loop and look items up by key.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const lookup = methodName(node)
        if (lookup === undefined || !LOOKUPS.has(lookup) || node.callee.type !== "MemberExpression") return
        const receiver = rootName(node.callee.object)
        if (receiver === undefined) return
        const callback = enclosingFunction(node.parent)
        if (callback === undefined || callback.parent.type !== "CallExpression") return
        const loop = methodName(callback.parent)
        if (loop === undefined || !ITERATIONS.has(loop) || !callback.parent.arguments.includes(callback)) return
        if (callback.params.flatMap(bindings).includes(receiver)) return
        context.report({ node, messageId: "lookup", data: { lookup, loop } })
      },
    }
  },
})
