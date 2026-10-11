import { defineRule } from "@oxlint/plugins"

const STORY = /\.stories\.[jt]sx?$/
const ALLOWED = [
  /\/packages\/ui\/src\/components\/[^/]+\.stories\.tsx$/,
  /\/packages\/app\/src\/features\/.+\.stories\.tsx$/,
  /\/packages\/storybook\/parity\/[^/]+\.stories\.tsx$/,
]

export const storyLocation = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep stories next to @ren/ui components and app features." },
    messages: {
      location:
        "Stories live beside their component: packages/ui/src/components/<name>.stories.tsx or packages/app/src/features/<domain>/<name>.stories.tsx. Storybook loads no other location.",
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
