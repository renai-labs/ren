import { defineRule } from "@oxlint/plugins"

export const preferLazyStateInit = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require an initializer function when initial state is computed." },
    messages: {
      lazy: "This runs on every render. Pass an initializer: `useState(() => ...)`.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return
        if (node.callee.name !== "useState" && node.callee.name !== "useReducer") return
        const initial = node.arguments[node.callee.name === "useState" ? 0 : 1]
        if (initial?.type !== "CallExpression" && initial?.type !== "NewExpression") return
        context.report({ node: initial, messageId: "lazy" })
      },
    }
  },
})
