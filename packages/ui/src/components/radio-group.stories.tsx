import type { Meta, StoryObj } from "@storybook/react-vite"
import { RadioGroup } from "./radio-group.js"

const meta = {
  title: "UI/Radio Group",
  component: RadioGroup.Root,
  args: { label: "Network access", children: null },
  render: (args) => (
    <RadioGroup.Root {...args}>
      <RadioGroup.Item value="unrestricted" label="Unrestricted" description="Agents can reach any host." />
      <RadioGroup.Item value="limited" label="Limited" description="Only approved destinations." />
    </RadioGroup.Root>
  ),
} satisfies Meta<typeof RadioGroup.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Unselected: Story = {}
export const Selected: Story = { args: { value: "limited" } }
export const WithoutDescriptions: Story = {
  args: { value: "unrestricted" },
  render: (args) => (
    <RadioGroup.Root {...args}>
      <RadioGroup.Item value="unrestricted" label="Unrestricted" />
      <RadioGroup.Item value="limited" label="Limited" />
    </RadioGroup.Root>
  ),
}
