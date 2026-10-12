import type { Meta, StoryObj } from "@storybook/react-vite"
import { CodeOutput } from "@ren/ui/code-output"

const log = Array.from(
  { length: 24 },
  (_, index) => `[${String(index + 1).padStart(2, "0")}] Resolved dependency graph for package ${index + 1} of 24`,
).join("\n")

const meta = {
  component: CodeOutput,
  args: {
    content:
      '{ "status": "ok", "message": "The deployment finished and every health check passed in the primary and secondary regions." }',
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeOutput>

export default meta

type Story = StoryObj<typeof meta>

export const Wrapped: Story = {}
export const Preformatted: Story = { args: { wrapping: "preformatted" } }
export const Secondary: Story = { args: { tone: "secondary" } }
export const Bounded: Story = { args: { content: log } }
export const ContentHeight: Story = { args: { content: log, height: "content" } }
export const Shell: Story = {
  args: {
    content: 'ren login --token "$REN_TOKEN" && ren sessions list --limit 5 | head\nren whoami',
    syntax: "shell",
    wrapping: "preformatted",
  },
}
export const Ellipsis: Story = { args: { continuation: "ellipsis" } }
export const ShowMore: Story = { args: { content: log, truncated: true, onShowMore: () => undefined } }
export const Copy: Story = { args: { onCopy: () => undefined } }
