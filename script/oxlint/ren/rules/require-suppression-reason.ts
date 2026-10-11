import { defineRule } from "@oxlint/plugins"

const DIRECTIVE = /^\s*(oxlint|eslint)-(disable|enable)(-next-line|-line)?\b/
const REASON = /\s--\s+\S/

export const requireSuppressionReason = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require a reason on every lint suppression comment." },
    messages: {
      reason: "Explain the suppression: `// oxlint-disable-next-line <rule> -- <why this case is the exception>`.",
    },
  },
  create(context) {
    return {
      Program() {
        context.sourceCode
          .getAllComments()
          .filter((comment) => DIRECTIVE.test(comment.value) && !/-enable/.test(comment.value))
          .filter((comment) => !REASON.test(comment.value))
          .forEach((comment) => context.report({ loc: comment.loc, messageId: "reason" }))
      },
    }
  },
})
