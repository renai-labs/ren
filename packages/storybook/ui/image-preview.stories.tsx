import type { Meta, StoryObj } from "@storybook/react-vite"
import { ImagePreview } from "@ren/ui/image-preview"

const chart =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='%23dfe8f5'/><rect x='40' y='90' width='40' height='60' fill='%230065cc'/><rect x='120' y='60' width='40' height='90' fill='%230065cc'/><rect x='200' y='30' width='40' height='120' fill='%230065cc'/></svg>"

const meta = {
  component: ImagePreview,
  args: { source: chart, description: "Revenue by quarter" },
  render: (args) => (
    <div className="w-80">
      <ImagePreview {...args} />
    </div>
  ),
} satisfies Meta<typeof ImagePreview>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
