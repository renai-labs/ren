import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "./icon.js"
import { Menu } from "./menu.js"
import { RowActionsMenu } from "./row-actions-menu.js"

const meta = {
  title: "UI/Row Actions Menu",
  component: RowActionsMenu,
  args: {
    label: "Actions for Ada Lovelace",
    children: (
      <>
        <Menu.Item icon={<Icon glyph="Link2" />}>Copy invite link</Menu.Item>
        <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />}>
          Remove
        </Menu.Item>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="flex h-80 items-start justify-center p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RowActionsMenu>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
