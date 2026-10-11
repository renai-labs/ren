import { defineRule } from "@oxlint/plugins"

export const jsxNoLeakedRender = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow `cond && <Element />`, which renders `0` or `NaN` for falsy numbers." },
    messages: {
      leak: "Use `condition ? <Element /> : null`. `&&` renders `0` and `NaN` when the condition is a number.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (node.operator !== "&&") return
        if (node.right.type !== "JSXElement" && node.right.type !== "JSXFragment") return
        context.report({ node, messageId: "leak" })
      },
    }
  },
})
