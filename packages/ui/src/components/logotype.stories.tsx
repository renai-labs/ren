import type { Meta, StoryObj } from "@storybook/react-vite"
import { Logotype } from "./logotype.js"

const meta = {
  title: "UI/Logotype",
  component: Logotype,
} satisfies Meta<typeof Logotype>

export default meta

type Story = StoryObj<typeof meta>

export const Small: Story = {}
export const Medium: Story = { args: { size: "medium" } }
export const Large: Story = { args: { size: "large" } }
export const Display: Story = { args: { size: "display" } }
export const Subdued: Story = { args: { size: "large", tone: "subdued" } }
export const Watermark: Story = { args: { size: "display", tone: "watermark", drawing: "outline", label: "" } }
export const Outline: Story = { args: { size: "display", drawing: "outline" } }
export const Loading: Story = { args: { size: "medium", tone: "subdued", activity: "loading" } }
