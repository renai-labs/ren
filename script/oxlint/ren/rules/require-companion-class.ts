import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const CLASS_FUNCTIONS = new Set(["cva", "composeClasses", "cn"])

const companions = [
  {
    when: /(?:^|:)outline-none$/,
    require: /(?:^|:)(?:focus-visible|focus-within|data-\[active=true\]):|:focus-visible\]:/,
    message:
      "`outline-none` removes the focus ring. Add a `focus-visible:` (or `focus-within:`) replacement in the same class list so keyboard users can see focus.",
  },
  {
    when: /(?:^|:)overflow(?:-[xy])?-(?:auto|scroll)$/,
    require: /(?:^|:)overscroll(?:-[xy])?-(?:contain|none)$/,
    message:
      "Scrolling past the end of this container scrolls the page behind it. Add `overscroll-contain` in the same class list.",
  },
]

const isClassRoot = (node: ESTree.Node) =>
  (node.type === "JSXAttribute" &&
    node.name.type === "JSXIdentifier" &&
    (node.name.name === "className" || node.name.name === "class")) ||
  (node.type === "CallExpression" && node.callee.type === "Identifier" && CLASS_FUNCTIONS.has(node.callee.name))

const insideClassRoot = (node: ESTree.Node): boolean => {
  if (node.type === "Program") return false
  return isClassRoot(node) || insideClassRoot(node.parent)
}

const isNode = (value: unknown): value is ESTree.Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"

const classStrings = (node: ESTree.Node): Array<{ node: ESTree.Node; tokens: string[] }> => {
  if (node.type === "Literal")
    return typeof node.value === "string" ? [{ node, tokens: node.value.split(/\s+/).filter(Boolean) }] : []
  if (node.type === "TemplateLiteral")
    return [{ node, tokens: node.quasis.flatMap((quasi) => quasi.value.raw.split(/\s+/).filter(Boolean)) }]
  if (node.type === "Property") return classStrings(node.value)
  return Object.entries(node)
    .filter((entry) => entry[0] !== "parent")
    .flatMap((entry): unknown[] => (Array.isArray(entry[1]) ? entry[1] : [entry[1]]))
    .filter(isNode)
    .flatMap(classStrings)
}

export const requireCompanionClass = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require the class that restores what another class takes away, in the same class list." },
    messages: { missing: "{{message}}" },
  },
  create(context) {
    const check = (root: ESTree.JSXAttribute | ESTree.CallExpression) => {
      if (insideClassRoot(root.parent)) return
      const strings = classStrings(root)
      const tokens = strings.flatMap((entry) => entry.tokens)
      for (const companion of companions) {
        if (tokens.some((token) => companion.require.test(token))) continue
        for (const entry of strings) {
          if (!entry.tokens.some((token) => companion.when.test(token))) continue
          context.report({ node: entry.node, messageId: "missing", data: { message: companion.message } })
        }
      }
    }
    return {
      JSXAttribute(node) {
        if (isClassRoot(node)) check(node)
      },
      CallExpression(node) {
        if (isClassRoot(node)) check(node)
      },
    }
  },
})
