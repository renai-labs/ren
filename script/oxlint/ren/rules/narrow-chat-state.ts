import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const typeContainers = new Set([
  "TSUnionType",
  "TSIntersectionType",
  "TSArrayType",
  "TSTypeParameterInstantiation",
  "TSTypeReference",
])

export const narrowChatState = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep whole-chat subscriptions in the chat view projection and state out of props." },
    messages: {
      subscription: "Read whole chat state in features/session/chat-view.ts and pass narrow values to components.",
      prop: "Component props must not contain ChatState.State. Pass the values the component renders.",
    },
  },
  create(context) {
    const chat = new Set<string>()
    const state = new Set<string>()
    const atomValue = new Set<string>()
    const isChatMember = (node: ESTree.Node, name: string) =>
      node.type === "MemberExpression" &&
      node.object.type === "Identifier" &&
      chat.has(node.object.name) &&
      !node.computed &&
      node.property.type === "Identifier" &&
      node.property.name === name
    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier" || specifier.imported.type !== "Identifier") continue
          if (node.source.value === "@ren/chat/react" && specifier.imported.name === "ChatReact")
            chat.add(specifier.local.name)
          if (node.source.value === "@ren/chat" && specifier.imported.name === "ChatState")
            state.add(specifier.local.name)
          if (node.source.value === "@effect/atom-react" && specifier.imported.name === "useAtomValue")
            atomValue.add(specifier.local.name)
        }
      },
      MemberExpression(node) {
        if (!context.filename.endsWith("/features/session/chat-view.ts") && isChatMember(node, "useSession"))
          context.report({ node, messageId: "subscription" })
      },
      CallExpression(node) {
        if (
          context.filename.endsWith("/features/session/chat-view.ts") ||
          node.callee.type !== "Identifier" ||
          !atomValue.has(node.callee.name)
        )
          return
        const argument = node.arguments[0]
        if (
          argument?.type === "CallExpression" &&
          argument.callee.type === "MemberExpression" &&
          argument.callee.property.type === "Identifier" &&
          argument.callee.property.name === "state" &&
          argument.callee.object.type === "CallExpression" &&
          isChatMember(argument.callee.object.callee, "useAtoms")
        )
          context.report({ node, messageId: "subscription" })
      },
      TSQualifiedName(node) {
        if (
          node.left.type !== "Identifier" ||
          !state.has(node.left.name) ||
          node.right.name !== "State" ||
          node.parent.type !== "TSTypeReference"
        )
          return
        let annotation: ESTree.Node | null = node.parent.parent
        while (annotation !== null && typeContainers.has(annotation.type)) annotation = annotation.parent
        if (annotation?.type === "TSTypeAnnotation" && annotation.parent.type === "TSPropertySignature")
          context.report({ node, messageId: "prop" })
      },
    }
  },
})
