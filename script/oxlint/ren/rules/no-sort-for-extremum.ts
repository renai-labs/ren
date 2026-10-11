import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const SORTS = new Set(["sort", "toSorted"])

const isSortCall = (node: ESTree.Node) =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  node.callee.property.type === "Identifier" &&
  SORTS.has(node.callee.property.name)

export const noSortForExtremum = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow sorting a whole array to read its smallest or largest item." },
    messages: {
      extremum: "Sorting is O(n log n) and allocates. Find the minimum or maximum in one pass.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!isSortCall(node.object)) return
        const first = node.computed && node.property.type === "Literal" && node.property.value === 0
        const at = !node.computed && node.property.type === "Identifier" && node.property.name === "at"
        if (!first && !at) return
        context.report({ node, messageId: "extremum" })
      },
    }
  },
})
