import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskPriorityIcon } from "@ren/ui/task-priority-icon"

const meta = {
  component: TaskPriorityIcon,
  args: { priority: null },
} satisfies Meta<typeof TaskPriorityIcon>

export default meta

type Story = StoryObj<typeof meta>

export const None: Story = {}
export const Low: Story = { args: { priority: "low" } }
export const Medium: Story = { args: { priority: "medium" } }
export const High: Story = { args: { priority: "high" } }
