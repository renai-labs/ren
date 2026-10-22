import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskDueDate } from "@ren/ui/task-due-date"
import { useState } from "react"

const meta = {
  component: TaskDueDate,
  args: {
    label: "Due date for Plan the migration",
    presentation: "row",
    value: "2099-03-14",
    onChange: () => undefined,
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return <TaskDueDate {...args} value={value} onChange={setValue} />
  },
} satisfies Meta<typeof TaskDueDate>
export default meta
type Story = StoryObj<typeof meta>
export const Row: Story = {}
export const Chip: Story = { args: { presentation: "chip" } }
export const Icon: Story = { args: { presentation: "icon" } }
export const Empty: Story = { args: { value: null } }
export const Overdue: Story = { args: { value: "2024-03-14" } }
export const OverdueIcon: Story = { args: { value: "2024-03-14", presentation: "icon" } }
export const Closed: Story = { args: { value: "2024-03-14", closed: true } }
export const Disabled: Story = { args: { disabled: true } }
export const Failed: Story = {
  render: (args) => <TaskDueDate {...args} onChange={() => Promise.reject(new Error("Couldn’t save the due date."))} />,
}
