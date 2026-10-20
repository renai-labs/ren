import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskProgress } from "@ren/ui/task-progress"

const meta = {
  component: TaskProgress,
  args: {
    tasks: [
      { id: "1", content: "Read the quarterly revenue report", status: "completed" },
      { id: "2", content: "Compare revenue with the forecast for each region", status: "in-progress" },
      { id: "3", content: "Draft the summary for the finance team", status: "pending" },
      { id: "4", content: "Book the review meeting", status: "cancelled" },
    ],
  },
} satisfies Meta<typeof TaskProgress>

export default meta

type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}
export const Expanded: Story = { args: { defaultOpen: true } }
export const Pending: Story = {
  args: {
    tasks: [
      { id: "1", content: "Read the quarterly revenue report", status: "pending" },
      { id: "2", content: "Draft the summary for the finance team", status: "pending" },
    ],
  },
}
export const Finished: Story = {
  args: {
    tasks: [
      { id: "1", content: "Read the quarterly revenue report", status: "completed" },
      { id: "2", content: "Draft the summary for the finance team", status: "completed" },
    ],
  },
}
