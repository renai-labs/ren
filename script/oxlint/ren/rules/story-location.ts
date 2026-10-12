import { defineRule } from "@oxlint/plugins"

const STORY = /\.stories\.[jt]sx?$/
const ALLOWED = [
  /\/packages\/storybook\/ui\/[^/]+\.stories\.tsx$/,
  /\/packages\/storybook\/app\/.+\.stories\.tsx$/,
  /\/packages\/storybook\/parity\/[^/]+\.stories\.tsx$/,
]

export const storyLocation = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep stories in packages/storybook." },
    messages: {
      location:
        "Stories live in packages/storybook: ui/<component>.stories.tsx or app/<domain>/<name>.stories.tsx. Storybook loads no other location.",
    },
  },
  create(context) {
    const file = context.filename
    if (!STORY.test(file) || ALLOWED.some((pattern) => pattern.test(file))) return {}
    return {
      Program(node) {
        context.report({ node, messageId: "location" })
      },
    }
  },
})
