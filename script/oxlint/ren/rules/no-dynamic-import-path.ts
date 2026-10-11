import { defineRule } from "@oxlint/plugins"

export const noDynamicImportPath = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require statically analyzable `import()` paths." },
    messages: {
      dynamic:
        "The bundler cannot tell what this imports, so it bundles every candidate. Use a literal path, or a map of literal `() => import(...)` loaders.",
    },
  },
  create(context) {
    return {
      ImportExpression(node) {
        const source = node.source
        if (source.type === "Literal") return
        if (source.type === "TemplateLiteral" && source.expressions.length === 0) return
        context.report({ node: source, messageId: "dynamic" })
      },
    }
  },
})
