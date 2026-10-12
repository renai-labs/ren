import type { Meta, StoryObj } from "@storybook/react-vite"
import { Breadcrumbs } from "@ren/ui/breadcrumbs"

const meta = {
  component: Breadcrumbs.Root,
  args: {
    children: (
      <>
        <Breadcrumbs.Link render={<a href="#tasks" />}>Tasks</Breadcrumbs.Link>
        <Breadcrumbs.Page>Migrate billing webhooks</Breadcrumbs.Page>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Breadcrumbs.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Nested: Story = {
  args: {
    children: (
      <>
        <Breadcrumbs.Link render={<a href="#projects" />}>Projects</Breadcrumbs.Link>
        <Breadcrumbs.Link render={<a href="#ren" />}>Ren</Breadcrumbs.Link>
        <Breadcrumbs.Page>Settings</Breadcrumbs.Page>
      </>
    ),
  },
}
export const Unlinked: Story = {
  args: {
    children: (
      <>
        <Breadcrumbs.Item>Tasks</Breadcrumbs.Item>
        <Breadcrumbs.Page>Migrate billing webhooks</Breadcrumbs.Page>
      </>
    ),
  },
}
export const LongLabel: Story = {
  args: {
    children: (
      <>
        <Breadcrumbs.Link render={<a href="#tasks" />}>Tasks</Breadcrumbs.Link>
        <Breadcrumbs.Page>Migrate the billing webhooks to the new event bus and retire the old queue</Breadcrumbs.Page>
      </>
    ),
  },
}
