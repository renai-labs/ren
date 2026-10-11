import type { Meta, StoryObj } from "@storybook/react-vite"
import { CopyButton } from "./copy-button.js"

const meta = {
  title: "UI/Copy Button",
  component: CopyButton,
  args: { value: "ren_live_4f9a2c", onCopy: () => Promise.resolve() },
} satisfies Meta<typeof CopyButton>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Labelled: Story = { args: { label: "Copy access token" } }
export const ExtraSmall: Story = { args: { size: "extra-small" } }
export const Failing: Story = {
  args: { onCopy: () => Promise.reject(new Error("Clipboard unavailable")) },
}
