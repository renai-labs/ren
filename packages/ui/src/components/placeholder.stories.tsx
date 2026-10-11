import type { Meta, StoryObj } from "@storybook/react-vite"
import { Placeholder } from "./placeholder.js"

const meta = {
  title: "UI/Placeholder",
  component: Placeholder,
} satisfies Meta<typeof Placeholder>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
