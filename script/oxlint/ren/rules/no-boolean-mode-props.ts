import { defineRule } from "@oxlint/plugins"

const MODE = /^(is|show|hide|has|with|without|enable|disable|use|should|can|allow)[A-Z]/

export const noBooleanModeProps = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow boolean props that switch a component between modes." },
    messages: {
      mode: "`{{name}}` switches the component between modes. Compose an explicit variant (`ThreadComposer`, not `Composer isThread`) or compound parts instead.",
    },
  },
  create(context) {
    if (!context.filename.endsWith(".tsx")) return {}
    return {
      TSPropertySignature(node) {
        if (node.key.type !== "Identifier" || !MODE.test(node.key.name)) return
        const annotation = node.typeAnnotation?.typeAnnotation
        if (annotation === undefined) return
        const boolean =
          annotation.type === "TSBooleanKeyword" ||
          (annotation.type === "TSUnionType" && annotation.types.some((type) => type.type === "TSBooleanKeyword"))
        if (!boolean) return
        context.report({ node: node.key, messageId: "mode", data: { name: node.key.name } })
      },
    }
  },
})
