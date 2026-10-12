import type { Meta, StoryObj } from "@storybook/react-vite"
import { CodeField } from "@ren/ui/code-field"

const meta = {
  component: CodeField,
  args: { slotLabel: "Code digit" },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeField>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Partial: Story = { args: { defaultValue: "12" } }
export const Complete: Story = { args: { defaultValue: "123456" } }
export const Invalid: Story = { args: { defaultValue: "123456", invalid: true } }
export const Disabled: Story = { args: { defaultValue: "12", disabled: true } }
export const ReadOnly: Story = { args: { defaultValue: "123456", readOnly: true } }
export const FourDigits: Story = { args: { length: 4 } }
