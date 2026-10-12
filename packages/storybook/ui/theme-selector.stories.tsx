import type { Meta, StoryObj } from "@storybook/react-vite"
import { ThemeSelector } from "@ren/ui/theme-selector"
import type { Theme } from "@ren/ui/theme"
import { useState } from "react"

const meta = {
  component: ThemeSelector,
  args: { value: "system", onValueChange: () => undefined },
  decorators: [
    (Story) => (
      <div className="w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ThemeSelector>

export default meta

type Story = StoryObj<typeof meta>

export const System: Story = {}
export const Dark: Story = { args: { value: "dark" } }
export const Girliepop: Story = { args: { value: "girliepop" } }

export const Interactive: Story = {
  render: function Render() {
    const [value, setValue] = useState<Theme.Preference>("light")
    return <ThemeSelector value={value} onValueChange={setValue} />
  },
}
