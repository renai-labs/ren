import { defineRule } from "@oxlint/plugins"

const SCROLL_EVENTS = new Set(["scroll", "wheel", "touchstart", "touchmove"])

export const requirePassiveListener = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require `{ passive: true }` on scroll, wheel and touch listeners." },
    messages: {
      passive: "Pass `{ passive: true }` to `{{event}}` listeners so they never block scrolling.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return
        if (callee.property.name !== "addEventListener") return
        const event = node.arguments[0]
        if (event?.type !== "Literal" || typeof event.value !== "string" || !SCROLL_EVENTS.has(event.value)) return
        const options = node.arguments[2]
        const passive =
          options?.type === "ObjectExpression" &&
          options.properties.some(
            (property) =>
              property.type === "Property" && property.key.type === "Identifier" && property.key.name === "passive",
          )
        if (passive) return
        context.report({ node, messageId: "passive", data: { event: event.value } })
      },
    }
  },
})
