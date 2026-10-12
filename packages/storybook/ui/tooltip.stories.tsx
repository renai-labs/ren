import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@ren/ui/button"
import { Tooltip } from "@ren/ui/tooltip"

const meta = {
  component: Tooltip.Root,
  args: { content: "Copy a link to this session", children: <Button appearance="outline">Share</Button> },
  decorators: [
    (Story) => (
      <Tooltip.Provider>
        <div className="flex justify-center p-12">
          <Story />
        </div>
      </Tooltip.Provider>
    ),
  ],
} satisfies Meta<typeof Tooltip.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Closed: Story = {}
export const Open: Story = { args: { open: true } }
export const Bottom: Story = { args: { open: true, placement: "bottom" } }
export const Right: Story = { args: { open: true, placement: "right" } }
export const AlignedStart: Story = { args: { open: true, alignment: "start" } }
export const Instant: Story = { args: { delay: 0 } }
