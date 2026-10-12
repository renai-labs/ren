import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@ren/ui/button"
import { Notice } from "@ren/ui/notice"

const meta = {
  component: Notice,
  args: { children: "Members can join this workspace with an invite link." },
} satisfies Meta<typeof Notice>

export default meta

type Story = StoryObj<typeof meta>

export const Information: Story = {}
export const Neutral: Story = { args: { tone: "neutral" } }
export const Warning: Story = {
  args: { tone: "warning", children: "Your trial ends in 3 days. Add a payment method to keep your sessions." },
}
export const Danger: Story = {
  args: { tone: "danger", children: "Unable to save changes. Check your connection and try again." },
}
export const Titled: Story = { args: { title: "Invite links are on" } }
export const TitleOnly: Story = { args: { title: "Invite links are on", children: undefined } }
export const Action: Story = {
  args: {
    tone: "danger",
    title: "Session failed",
    children: "The environment stopped before the session finished.",
    action: (
      <Button appearance="plain" size="small">
        Restart session
      </Button>
    ),
  },
}
export const Inline: Story = { args: { placement: "inline" } }
export const InlineDanger: Story = {
  args: { placement: "inline", tone: "danger", children: "Unable to load labels. Try again." },
}
export const InlineLayout: Story = {
  args: {
    tone: "neutral",
    layout: "inline",
    title: "Read only.",
    children: "Subagent sessions cannot be prompted.",
  },
}
export const InlineLayoutAction: Story = {
  args: {
    tone: "danger",
    layout: "inline",
    title: "Session failed.",
    children: "The environment stopped before the session finished.",
    action: (
      <Button appearance="plain" size="small">
        Restart session
      </Button>
    ),
  },
}
