import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "@ren/ui/icon"
import { SegmentedControl } from "@ren/ui/segmented-control"

const meta = {
  component: SegmentedControl<string>,
  args: {
    label: "View",
    value: "board",
    onValueChange: () => undefined,
    options: [
      { value: "board", label: "Board" },
      { value: "list", label: "List" },
      { value: "calendar", label: "Calendar" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="flex w-96 justify-center p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SegmentedControl<string>>

export default meta

type Story = StoryObj<typeof meta>

export const Medium: Story = {}
export const Small: Story = { args: { size: "small" } }
export const Full: Story = { args: { width: "full" } }
export const DisabledOption: Story = {
  args: {
    options: [
      { value: "board", label: "Board" },
      { value: "list", label: "List" },
      { value: "calendar", label: "Calendar", disabled: true },
    ],
  },
}
export const Icons: Story = {
  args: {
    label: "Theme",
    value: "light",
    options: [
      { value: "light", label: <Icon glyph="Sun" label="Light" /> },
      { value: "dark", label: <Icon glyph="Moon" label="Dark" /> },
    ],
  },
}
export const Described: Story = {
  args: {
    label: "Network access",
    value: "unrestricted",
    options: [
      { value: "unrestricted", label: "Unrestricted", description: "Agents can reach any host." },
      { value: "limited", label: "Limited", description: "Only approved destinations." },
    ],
  },
}
