import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskTurn } from "@ren/ui/task-turn"

const meta = {
  component: TaskTurn,
  args: { state: "not_started" },
} satisfies Meta<typeof TaskTurn>

export default meta

type Story = StoryObj<typeof meta>

export const NotStarted: Story = {}
export const AgentNotStarted: Story = { args: { state: "not_started", name: "Plan" } }
export const Working: Story = { args: { state: "working", name: "Build" } }
export const Idle: Story = { args: { state: "idle", name: "Review" } }
export const Stopped: Story = { args: { state: "stopped", name: "Build" } }
export const NeedsYou: Story = {
  args: {
    state: "needs_you",
    name: "Shrey",
    reason: "Plan approval. The plan is in the description.\nOpen risks: SCIM, MFA.",
  },
}
export const OwnerWorking: Story = { args: { state: "owner_working", name: "Shrey" } }
export const Done: Story = { args: { state: "done" } }
export const Dismissed: Story = { args: { state: "dismissed" } }
