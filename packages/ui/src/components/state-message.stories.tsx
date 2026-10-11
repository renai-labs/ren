import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import { StateMessage } from "./state-message.js"

const meta = {
  title: "UI/State Message",
  component: StateMessage,
  args: { state: "empty" },
} satisfies Meta<typeof StateMessage>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const NoResults: Story = { args: { state: "no-results" } }
export const Complete: Story = { args: { state: "complete" } }
export const Unavailable: Story = { args: { state: "unavailable" } }
export const Failed: Story = { args: { state: "failed", title: "Unable to load sessions." } }
export const Retry: Story = {
  args: { state: "failed", title: "Unable to load sessions.", onRetry: () => undefined },
}
export const Description: Story = {
  args: { title: "No projects yet.", description: "Projects group the sessions, files and tools your team shares." },
}
export const CustomIcon: Story = {
  args: { title: "No projects yet.", icon: <Icon glyph="Folder" size="large" tone="secondary" /> },
}
export const Action: Story = {
  args: {
    title: "No projects yet.",
    action: (
      <Button appearance="primary" size="small">
        Create project
      </Button>
    ),
  },
}
export const Inline: Story = { args: { placement: "inline" } }
export const InlineFailed: Story = {
  args: { state: "failed", placement: "inline", title: "Unable to load labels.", onRetry: () => undefined },
}
export const Page: Story = { args: { state: "unavailable", placement: "page" } }
