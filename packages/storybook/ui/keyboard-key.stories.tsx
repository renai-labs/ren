import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "@ren/ui/icon"
import { KeyboardKey } from "@ren/ui/keyboard-key"

const meta = {
  component: KeyboardKey,
  args: { children: "Tab" },
} satisfies Meta<typeof KeyboardKey>

export default meta

type Story = StoryObj<typeof meta>

export const Word: Story = {}
export const Return: Story = { args: { children: "↵" } }
export const Glyph: Story = { args: { children: <Icon glyph="ArrowUp" /> } }
