import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button.js"
import { PreviewCard } from "./preview-card.js"
import { Text } from "./text.js"

const meta = {
  title: "UI/Preview Card",
  component: PreviewCard.Content,
  args: { children: <Text>Design review · 4 open tasks, last updated 2 hours ago.</Text> },
  render: (args) => (
    <PreviewCard.Root defaultOpen>
      <PreviewCard.Trigger render={<Button appearance="outline">Design review</Button>} />
      <PreviewCard.Content {...args} />
    </PreviewCard.Root>
  ),
  decorators: [
    (Story) => (
      <div className="flex h-80 items-center justify-center p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreviewCard.Content>

export default meta

type Story = StoryObj<typeof meta>

export const Closed: Story = {
  render: (args) => (
    <PreviewCard.Root>
      <PreviewCard.Trigger render={<Button appearance="outline">Design review</Button>} />
      <PreviewCard.Content {...args} />
    </PreviewCard.Root>
  ),
}
export const Open: Story = {}
export const Top: Story = { args: { placement: "top" } }
export const Right: Story = { args: { placement: "right", padding: "small" } }
export const AlignedEnd: Story = { args: { alignment: "end" } }
export const LargePadding: Story = { args: { padding: "large" } }
