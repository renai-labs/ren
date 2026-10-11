import type { Meta, StoryObj } from "@storybook/react-vite"
import { Separator } from "./separator.js"

const meta = {
  title: "UI/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>

export default meta

type Story = StoryObj<typeof meta>

export const Horizontal: Story = {}
export const Vertical: Story = {
  args: { orientation: "vertical" },
  decorators: [
    (Story) => (
      <div className="flex h-8">
        <Story />
      </div>
    ),
  ],
}
export const Labelled: Story = { args: { label: "Compaction" } }
