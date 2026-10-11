import type { Meta, StoryObj } from "@storybook/react-vite"
import { PasswordField } from "./password-field.js"

const meta = {
  title: "UI/Password Field",
  component: PasswordField,
  args: { "aria-label": "Password", defaultValue: "correct horse battery staple" },
} satisfies Meta<typeof PasswordField>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { args: { defaultValue: undefined, placeholder: "At least 12 characters" } }
export const Filled: Story = { args: { appearance: "filled" } }
export const Large: Story = { args: { size: "large" } }
export const Invalid: Story = { args: { invalid: true } }
export const Disabled: Story = { args: { disabled: true } }
