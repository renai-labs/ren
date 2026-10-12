import type { Meta, StoryObj } from "@storybook/react-vite"
import { Link } from "@ren/ui/link"

const meta = {
  component: Link,
  args: { href: "#", children: "View pricing" },
} satisfies Meta<typeof Link>

export default meta

type Story = StoryObj<typeof meta>

export const Inline: Story = {}
export const Standalone: Story = { args: { appearance: "standalone" } }
export const Quiet: Story = { args: { appearance: "quiet" } }
export const Navigation: Story = { args: { appearance: "navigation", children: "Inference keys" } }
export const External: Story = {
  args: { external: true, href: "https://docs.ren.ai", children: "Read the CLI guide" },
}
