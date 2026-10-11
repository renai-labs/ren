import { defineRule } from "@oxlint/plugins"

const RENDER_PROP = /^render[A-Z]/

export const noRenderProps = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow `renderX` props in favour of children and compound components." },
    messages: {
      renderProp:
        "`{{name}}` is a render prop. Pass children or compose compound parts. Keep a render prop only when the parent hands data back (for example a virtualized row), and suppress with a reason.",
    },
  },
  create(context) {
    return {
      TSPropertySignature(node) {
        if (node.key.type !== "Identifier" || !RENDER_PROP.test(node.key.name)) return
        context.report({ node: node.key, messageId: "renderProp", data: { name: node.key.name } })
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !RENDER_PROP.test(node.name.name)) return
        context.report({ node: node.name, messageId: "renderProp", data: { name: node.name.name } })
      },
    }
  },
})
