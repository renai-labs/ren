import type { Meta, StoryObj } from "@storybook/react-vite"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { Document } from "@ren/ui/document"

const prose = `## Release notes

The sync service now retries **failed uploads** with backoff, and the [status page](https://example.com) reports each region separately.

- Uploads resume after a dropped connection
- Retries stop after five attempts
  - Each attempt waits twice as long
- The \`ren sync\` command prints a summary

1. Update the CLI
2. Run \`ren sync --check\`

> Existing sessions keep their settings.

---

### Known issues

Large folders can take a minute to index.`

const table = `| Region | Status | Latency |
| --- | --- | --- |
| us-east | Healthy | 42 ms |
| eu-west | Degraded | 180 ms |`

const meta = {
  component: Document.Markdown,
  args: { content: prose },
  loaders: [
    async () => {
      const root = createRoot(document.createElement("div"))
      flushSync(() => root.render(<Document.Markdown content="" />))
      await Document.preload()
      await new Promise((resolve) => setTimeout(resolve, 0))
      root.unmount()
    },
  ],
  decorators: [
    (Story) => (
      <div className="w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Document.Markdown>

export default meta

type Story = StoryObj<typeof meta>

export const Compact: Story = {}
export const Standard: Story = { args: { scale: "standard" } }
export const Secondary: Story = { args: { tone: "secondary" } }
export const Streaming: Story = { args: { source: "streaming" } }
export const Table: Story = { args: { content: table } }
export const CodeBlock: Story = {
  args: { content: "Install the CLI:\n\n```ts\nconst greeting: string = 'hello'\nconsole.log(greeting)\n```" },
}
export const Code: Story = {
  render: () => <Document.Code content="ren sync --check" wrapping="preformatted" height="content" syntax="shell" />,
}
export const Media: Story = {
  render: () => <Document.Media kind="embed" source="about:blank" description="Setup walkthrough" loading="eager" />,
}
