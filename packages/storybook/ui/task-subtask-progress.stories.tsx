import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskSubtaskProgress } from "@ren/ui/task-subtask-progress"

const meta = {
  component: TaskSubtaskProgress,
  args: { done: 0, total: 3 },
} satisfies Meta<typeof TaskSubtaskProgress>
export default meta
type Story = StoryObj<typeof meta>
export const NoneDone: Story = {}
export const SomeDone: Story = { args: { done: 2, total: 5 } }
export const AllDone: Story = { args: { done: 3, total: 3 } }
