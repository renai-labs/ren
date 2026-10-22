import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"

const meta = {
  component: TaskStatusCircle,
  args: { status: "todo" },
} satisfies Meta<typeof TaskStatusCircle>

export default meta

type Story = StoryObj<typeof meta>

export const Todo: Story = {}
export const InProgress: Story = { args: { status: "in_progress" } }
export const Done: Story = { args: { status: "done" } }
export const Dismissed: Story = { args: { status: "dismissed" } }
