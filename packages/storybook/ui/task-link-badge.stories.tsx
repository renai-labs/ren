import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"

const meta = {
  component: TaskLinkBadge,
  args: { link: { kind: "github_pr", url: "https://github.com/renai-labs/ren/pull/482" } },
} satisfies Meta<typeof TaskLinkBadge>

export default meta

type Story = StoryObj<typeof meta>

export const GithubPullRequest: Story = {}
export const LinearIssue: Story = {
  args: { link: { kind: "linear_issue", url: "https://linear.app/renai/issue/REN-1442/tasks" } },
}
export const SlackThread: Story = {
  args: { link: { kind: "slack_thread", url: "https://renai.slack.com/archives/C024BE91L/p1700000000123456" } },
}
export const Url: Story = { args: { link: { kind: "url", url: "https://www.example.com/docs/sso" } } }
export const Path: Story = { args: { link: { kind: "url", url: "/spaces/design/settings" } } }
export const Small: Story = { args: { size: "small" } }
