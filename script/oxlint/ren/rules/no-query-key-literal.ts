import { defineRule } from "@oxlint/plugins"

export const noQueryKeyLiteral = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow hand-written TanStack Query keys." },
    messages: {
      literal:
        "Hand-written query keys drift from the API. Use the generated query options from @ren/client/react, or a key factory next to them.",
    },
  },
  create(context) {
    return {
      Property(node) {
        const name = node.key.type === "Identifier" ? node.key.name : undefined
        if (name !== "queryKey" && name !== "mutationKey") return
        if (node.value.type !== "ArrayExpression") return
        context.report({ node: node.value, messageId: "literal" })
      },
    }
  },
})
