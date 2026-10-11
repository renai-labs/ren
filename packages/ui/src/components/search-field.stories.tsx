import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { SearchField } from "./search-field.js"

const meta = {
  title: "UI/Search Field",
  component: SearchField.Root,
  args: { value: "", onValueChange: () => undefined },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return <SearchField.Root {...args} value={value} onValueChange={setValue} />
  },
} satisfies Meta<typeof SearchField.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Filled: Story = {}
export const WithValue: Story = { args: { value: "billing" } }
export const Outline: Story = { args: { appearance: "outline" } }
export const Compact: Story = { args: { size: "compact" } }
export const Medium: Story = { args: { size: "medium" } }
export const WithoutIcon: Story = { args: { icon: "hidden" } }
export const WidthFill: Story = { args: { width: "fill" } }
export const Labelled: Story = { args: { placeholder: "Find", label: "Search projects" } }
export const Expandable: Story = {
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return <SearchField.Expandable {...args} value={value} onValueChange={setValue} />
  },
}
export const ExpandableWithValue: Story = { ...Expandable, args: { value: "billing" } }
export const ExpandableMedium: Story = { ...Expandable, args: { size: "medium" } }
