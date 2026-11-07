import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const OPENCODE = /^@opencode\/|(^|[/\\])node_modules[/\\]@opencode[/\\]/
const BOUNDARY = /[/\\]packages[/\\](cell[/\\](src[/\\]harness[/\\]opencode|test)|opencode-transcript)[/\\]/
const E2E = /[/\\]packages[/\\]e2e[/\\]/

export const opencodeBoundary = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep OpenCode inside its boundary, so an OpenCode upgrade changes only the boundary." },
    messages: {
      outside:
        "Only cell/src/harness/opencode, opencode-transcript and cell's tests use OpenCode. Core takes a harness's code through a registry such as TranscriptCodec; other packages use Ren's types and @ren/cell/testing.",
      e2e: "End-to-end tests drive a cell from outside, with @opencode/client only.",
    },
  },
  create(context) {
    const file = context.filename
    if (BOUNDARY.test(file)) return {}
    const e2e = E2E.test(file)
    const check = (node: ESTree.Node, source: string) => {
      if (!OPENCODE.test(source)) return
      if (!e2e) return context.report({ node, messageId: "outside" })
      if (source !== "@opencode/client") context.report({ node, messageId: "e2e" })
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
