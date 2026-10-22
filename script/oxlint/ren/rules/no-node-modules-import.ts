import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

export const noNodeModulesImport = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Import dependencies by package name, not through node_modules paths." },
    messages: { path: "Import the package by name. Paths through node_modules depend on the install layout." },
  },
  create(context) {
    const check = (node: ESTree.Node, source: string) => {
      if (/(^|[/\\])node_modules([/\\]|$)/.test(source)) context.report({ node, messageId: "path" })
    }
    return {
      ImportDeclaration(node) {
        check(node, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) check(node, node.source.value)
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string") check(node, node.source.value)
      },
    }
  },
})
