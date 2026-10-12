import type { StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import type { ComponentProps } from "react"
import { SearchField } from "ren-v1/composites/controls"

export default {
  component: SearchField,
  args: { value: "", onValueChange: () => undefined },
  render: function Render(args: ComponentProps<typeof SearchField>) {
    const [value, setValue] = useState(args.value)
    return <SearchField {...args} value={value} onValueChange={setValue} />
  },
}

type Story = StoryObj<typeof SearchField>

export const Filled: Story = {}
export const WithValue: Story = { args: { value: "billing" } }
export const Outline: Story = { args: { appearance: "outline" } }
export const Compact: Story = { args: { size: "compact" } }
export const Medium: Story = { args: { size: "medium" } }
export const WithoutIcon: Story = { args: { icon: "hidden" } }
export const WidthFill: Story = { args: { width: "fill" } }
export const Labelled: Story = { args: { placeholder: "Find", label: "Search projects" } }
export const Expandable: Story = { args: { presentation: "expandable" } }
export const ExpandableWithValue: Story = { args: { presentation: "expandable", value: "billing" } }
export const ExpandableMedium: Story = { args: { presentation: "expandable", size: "medium" } }
