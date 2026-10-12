import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { InlineEdit } from "@ren/ui/inline-edit"

const meta = {
  component: InlineEdit,
  args: { label: "Name", value: "Ada Lovelace", placeholder: "Add your name", onCommit: () => undefined },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return <InlineEdit {...args} value={value} onCommit={setValue} />
  },
  decorators: [
    (Story) => (
      <div className="flex w-80 flex-col">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InlineEdit>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { args: { value: "" } }
export const EndAligned: Story = { args: { alignment: "end" } }
export const Required: Story = { args: { required: true } }
export const LongValue: Story = {
  args: { value: "Ada Lovelace, Countess of Lovelace and author of the first published algorithm" },
}
export const Validated: Story = {
  args: { validate: (value) => (value.length < 3 ? "Use at least 3 characters." : null) },
}
export const Failing: Story = {
  render: (args) => <InlineEdit {...args} onCommit={() => Promise.reject(new Error("That name is taken."))} />,
}
