import { defineRule } from "@oxlint/plugins"

const DIRECTIVE = /^\s*((oxlint|eslint)-(disable|enable)(-next-line|-line)?\b|ast-grep-ignore:|@ts-expect-error\s+\S)/

export const noComments = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow comments other than lint and TypeScript directives." },
    messages: {
      comment:
        "Remove the comment and make the code explain itself through names and structure. If a non-obvious constraint truly needs one, suppress this rule with the reason.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang" || DIRECTIVE.test(comment.value)) continue
          context.report({ loc: comment.loc, messageId: "comment" })
        }
      },
    }
  },
})
