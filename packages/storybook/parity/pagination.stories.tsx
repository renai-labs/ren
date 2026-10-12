import type { StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import type { ComponentProps } from "react"
import { Pagination } from "ren-v1/composites/navigation"

export default {
  component: Pagination,
  args: { page: 3, pageCount: 10, onPageChange: () => undefined },
  render: function Render(args: ComponentProps<typeof Pagination>) {
    const [page, setPage] = useState(args.page)
    return <Pagination {...args} page={page} onPageChange={setPage} />
  },
}

type Story = StoryObj<typeof Pagination>

export const Compact: Story = {}
export const FirstPage: Story = { args: { page: 1 } }
export const LastPage: Story = { args: { page: 10 } }
export const Numbered: Story = { args: { presentation: "numbered", page: 6, pageCount: 12 } }
export const NumberedStart: Story = { args: { presentation: "numbered", page: 1, pageCount: 12 } }
export const NumberedFew: Story = { args: { presentation: "numbered", page: 2, pageCount: 5 } }
