import type { Meta, StoryObj } from "@storybook/react-vite"
import { CopyButton } from "@ren/ui/copy-button"

const meta = {
  component: CopyButton,
  args: { value: "ren_live_4f9a2c", onCopy: (value) => navigator.clipboard.writeText(value) },
} satisfies Meta<typeof CopyButton>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Labelled: Story = { args: { label: "Copy access token" } }
export const ExtraSmall: Story = { args: { size: "extra-small" } }
export const Failing: Story = {
  args: { onCopy: () => Promise.reject(new Error("Clipboard unavailable")) },
}
