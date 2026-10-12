import type { Meta, StoryObj } from "@storybook/react-vite"
import { Breadcrumbs } from "ren-v1/composites/navigation"

export default {
  component: Breadcrumbs,
  args: {
    items: [
      { key: "tasks", label: "Tasks", link: <a href="#tasks" /> },
      { key: "title", label: "Migrate billing webhooks" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Breadcrumbs>

type Story = StoryObj<typeof Breadcrumbs>

export const Default: Story = {}
export const Nested: Story = {
  args: {
    items: [
      { key: "projects", label: "Projects", link: <a href="#projects" /> },
      { key: "ren", label: "Ren", link: <a href="#ren" /> },
      { key: "settings", label: "Settings" },
    ],
  },
}
export const Unlinked: Story = {
  args: {
    items: [
      { key: "tasks", label: "Tasks" },
      { key: "title", label: "Migrate billing webhooks" },
    ],
  },
}
export const LongLabel: Story = {
  args: {
    items: [
      { key: "tasks", label: "Tasks", link: <a href="#tasks" /> },
      { key: "title", label: "Migrate the billing webhooks to the new event bus and retire the old queue" },
    ],
  },
}
