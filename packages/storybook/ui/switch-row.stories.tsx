import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import type { ComponentProps } from "react"
import { SwitchRow } from "@ren/ui/switch-row"

const meta = {
  component: SwitchRow,
  args: {
    title: "Review pull requests when ready",
    description: "When a pull request is opened, or marked ready for review. Not for a draft, and not on each push.",
    checked: false,
    onCheckedChange: () => undefined,
  },
  render: function Render(args: ComponentProps<typeof SwitchRow>) {
    const [checked, setChecked] = useState(args.checked)
    return <SwitchRow {...args} checked={checked} onCheckedChange={setChecked} />
  },
} satisfies Meta<typeof SwitchRow>

export default meta

type Story = StoryObj<typeof meta>

export const Off: Story = {}
export const On: Story = { args: { checked: true } }
export const Disabled: Story = { args: { disabled: true } }
