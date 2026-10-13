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
        for (const comment of context.sourceCode.getAllComments()) {
          if (!DIRECTIVE.test(comment.value) || comment.value.includes("-enable") || REASON.test(comment.value))
            continue
          context.report({ loc: comment.loc, messageId: "reason" })
        }
      },
    }
  },
})
