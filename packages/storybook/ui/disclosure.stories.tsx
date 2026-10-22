import type { Meta, StoryObj } from "@storybook/react-vite"
import { Disclosure } from "@ren/ui/disclosure"
import { Text } from "@ren/ui/text"

const meta = {
  component: Disclosure,
  args: {
    summary: "Show 4 more events",
    children: (
      <>
        <Text purpose="body">Changed priority.</Text>
        <Text purpose="body">Changed due date.</Text>
      </>
    ),
  },
} satisfies Meta<typeof Disclosure>

export default meta

type Story = StoryObj<typeof meta>

export const Closed: Story = {}
export const Open: Story = { args: { defaultOpen: true } }
