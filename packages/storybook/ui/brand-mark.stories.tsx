import type { Meta, StoryObj } from "@storybook/react-vite"
import { BrandMark } from "@ren/ui/brand-mark"
import { Button } from "@ren/ui/button"

const meta = {
  component: BrandMark,
  args: { brand: "google" },
} satisfies Meta<typeof BrandMark>

export default meta

type Story = StoryObj<typeof meta>

export const Google: Story = {}
export const Large: Story = { args: { size: "large" } }
export const InButton: Story = {
  render: (args) => (
    <div className="w-80">
      <Button appearance="secondary" size="large" width="full" leadingIcon={<BrandMark {...args} />}>
        Continue with Google
      </Button>
    </div>
  ),
}
