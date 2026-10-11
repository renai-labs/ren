import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const COPY_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "alt",
  "title",
  "placeholder",
  "label",
  "description",
])
const COPY_KEYS = new Set(["title", "description", "label", "placeholder", "message"])

const checks = [
  { pattern: /\.\.\./, message: "Use the ellipsis character `…` instead of three dots." },
  { pattern: /\s--\s/, message: "Use an em dash `—` instead of `--`." },
  { pattern: /['"]/, message: "Use typographic quotes: ’ for apostrophes, ‘ ’ and “ ” for quotations." },
  { pattern: /\boops\b/i, message: "Errors stay calm. Say what failed and how to fix it." },
  {
    pattern: /\bsomething went wrong\b/i,
    message: "Say what failed and how to fix it, for example “Unable to save. Check your connection and try again.”",
  },
  { pattern: /\bsuccessfully\b/i, message: "Cut “successfully”: “Changes saved”." },
  { pattern: /\bare you sure\b/i, message: "Name the action and the object: “Delete ‘Q3 report’?”." },
  { pattern: /^\s*please\b/i, message: "Cut “Please” from routine instructions." },
  { pattern: /\bclick here\b/i, message: "Name the destination or the action instead of “click here”." },
  {
    pattern: /^\s*(?:ok|yes|no)\s*$/i,
    message: "Label actions with a verb and object, such as “Delete project” and “Cancel”.",
  },
]
const glyphLabel = {
  pattern: /\bicon\b|^\s*[x×]\s*$/i,
  message: "Name the action, such as “Close dialog”, not the glyph.",
}

const attributeName = (node: ESTree.JSXAttribute) =>
  node.name.type === "JSXIdentifier" ? node.name.name : node.name.name.name

const keyName = (node: Extract<ESTree.Node, { type: "Property" }>) => {
  if (node.computed) return undefined
  if (node.key.type === "Identifier") return node.key.name
  if (node.key.type === "Literal" && typeof node.key.value === "string") return node.key.value
  return undefined
}

const copyContext = (node: ESTree.Node): string | undefined => {
  if (node.type === "Program") return undefined
  const parent = node.parent
  if (parent.type === "ConditionalExpression" || parent.type === "LogicalExpression") return copyContext(parent)
  if (parent.type === "JSXExpressionContainer") return copyContext(parent)
  if (parent.type === "JSXElement" || parent.type === "JSXFragment") return "children"
  if (parent.type === "JSXAttribute") {
    const name = attributeName(parent)
    return COPY_ATTRIBUTES.has(name) ? name : undefined
  }
  if (parent.type === "Property" && parent.value === node) {
    const name = keyName(parent)
    return name !== undefined && COPY_KEYS.has(name) ? name : undefined
  }
  return undefined
}

export const interfaceCopy = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Enforce typographic punctuation and plain, actionable interface copy." },
    messages: { copy: "{{message}}" },
  },
  create(context) {
    const check = (node: ESTree.Node, text: string, where: string) => {
      const applicable = where === "aria-label" ? [...checks, glyphLabel] : checks
      applicable
        .filter((entry) => entry.pattern.test(text))
        .forEach((entry) => context.report({ node, messageId: "copy", data: { message: entry.message } }))
    }
    return {
      JSXText(node) {
        if (node.value.trim() !== "") check(node, node.value, "children")
      },
      Literal(node) {
        if (typeof node.value !== "string") return
        const where = copyContext(node)
        if (where !== undefined) check(node, node.value, where)
      },
      TemplateLiteral(node) {
        const where = copyContext(node)
        if (where !== undefined) check(node, node.quasis.map((quasi) => quasi.value.cooked ?? "").join(" "), where)
      },
    }
  },
})
