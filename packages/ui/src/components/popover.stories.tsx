import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button.js"
import { Popover } from "./popover.js"
import { Text } from "./text.js"

const meta = {
  title: "UI/Popover",
  component: Popover.Content,
  args: {
    label: "Task display",
    children: <Text>Group tasks by status, assignee or label, and choose which properties each row shows.</Text>,
  },
  render: (args) => (
    <Popover.Root defaultOpen>
      <Popover.Trigger render={<Button appearance="outline">Display</Button>} />
      <Popover.Content {...args} />
    </Popover.Root>
  ),
  decorators: [
    (Story) => (
      <div className="flex h-80 items-center justify-center p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Popover.Content>

export default meta

type Story = StoryObj<typeof meta>

export const Closed: Story = {
  render: (args) => (
    <Popover.Root>
      <Popover.Trigger render={<Button appearance="outline">Display</Button>} />
      <Popover.Content {...args}>
        {args.children}
        <Popover.Close render={<Button appearance="outline">Done</Button>} />
      </Popover.Content>
    </Popover.Root>
  ),
}
export const Open: Story = {}
export const Top: Story = { args: { placement: "top" } }
export const Right: Story = { args: { placement: "right" } }
export const AlignedEnd: Story = { args: { alignment: "end" } }
export const SmallPadding: Story = { args: { padding: "small" } }
export const LargePadding: Story = { args: { padding: "large" } }
