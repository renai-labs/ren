import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "./icon.js"
import { KeyboardKey } from "./keyboard-key.js"

const meta = {
  title: "UI/Keyboard Key",
  component: KeyboardKey,
  args: { children: "Tab" },
} satisfies Meta<typeof KeyboardKey>

export default meta

type Story = StoryObj<typeof meta>

export const Word: Story = {}
export const Return: Story = { args: { children: "↵" } }
export const Glyph: Story = { args: { children: <Icon glyph="ArrowUp" /> } }
