import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Calendar } from "@ren/ui/calendar"

const meta = {
  component: Calendar,
  args: { value: "", onSelect: () => {} },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Calendar>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Selected: Story = { args: { value: "2026-03-14" } }
export const Interactive: Story = {
  render: function Render() {
    const [value, setValue] = useState("2026-03-14")
    return <Calendar value={value} onSelect={setValue} />
  },
}
