import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"
import path from "path"

const FEATURE = /\/packages\/app\/src\/features\/([^/]+)\//
const SHARED = /\/packages\/app\/src\/(components|lib|platform)\//

export const featureBoundaries = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep app features independent of each other." },
    messages: {
      crossFeature:
        "Feature `{{from}}` imports feature `{{to}}`. Features never import each other: compose them in a route, or move the shared piece to src/components or src/lib.",
      sharedToFeature: "src/{{layer}} imports feature `{{to}}`. Shared layers never depend on features.",
    },
  },
  create(context) {
    const file = context.filename
    const from = FEATURE.exec(file)?.[1]
    const layer = SHARED.exec(file)?.[1]
    if (from === undefined && layer === undefined) return {}
    const check = (node: ESTree.Node, source: string) => {
      if (!source.startsWith(".")) return
      const to = FEATURE.exec(path.resolve(path.dirname(file), source) + "/")?.[1]
      if (to === undefined || to === from) return
      if (from !== undefined) return context.report({ node, messageId: "crossFeature", data: { from, to } })
      context.report({ node, messageId: "sharedToFeature", data: { layer: layer ?? "", to } })
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
