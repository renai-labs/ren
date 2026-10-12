import type { Meta, StoryObj } from "@storybook/react-vite"
import { CodeField } from "@ren/ui/code-field"
import { Text } from "@ren/ui/text"

const meta = {
  component: CodeField,
  args: { slotLabel: "Code digit", "aria-labelledby": "code-field-label" },
  decorators: [
    (Story) => (
      <div className="flex w-80 flex-col gap-2">
        <Text purpose="label" id="code-field-label">
          Verification code
        </Text>
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
export const InvalidWithMessage: Story = {
  args: { defaultValue: "123456", invalid: true, "aria-describedby": "code-field-error" },
  render: (args) => (
    <>
      <CodeField {...args} />
      <Text tone="danger" id="code-field-error">
        That code didn’t work. Check it and try again.
      </Text>
    </>
  ),
}
export const Disabled: Story = { args: { defaultValue: "12", disabled: true } }
export const ReadOnly: Story = { args: { defaultValue: "123456", readOnly: true } }
export const FourDigits: Story = { args: { length: 4 } }
