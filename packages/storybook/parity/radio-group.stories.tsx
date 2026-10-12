import type { StoryObj } from "@storybook/react-vite"
import { RadioGroup } from "ren-v1/primitives/selection-controls"

export default { component: RadioGroup }

type Story = StoryObj<typeof RadioGroup>

const options = [
  { value: "unrestricted", label: "Unrestricted", description: "Agents can reach any host." },
  { value: "limited", label: "Limited", description: "Only approved destinations." },
]

export const Unselected: Story = { args: { label: "Network access", options } }
export const Selected: Story = { args: { label: "Network access", options, value: "limited" } }
export const WithoutDescriptions: Story = {
  args: {
    label: "Network access",
    value: "unrestricted",
    options: options.map((option) => ({ value: option.value, label: option.label })),
  },
}
