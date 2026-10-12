import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Pagination } from "./pagination.js"

const meta = {
  title: "UI/Pagination",
  component: Pagination.Root,
  args: { page: 3, pageCount: 10, onPageChange: () => undefined },
  render: function Render(args) {
    const [page, setPage] = useState(args.page)
    return <Pagination.Root {...args} page={page} onPageChange={setPage} />
  },
} satisfies Meta<typeof Pagination.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Compact: Story = {}
export const FirstPage: Story = { args: { page: 1 } }
export const LastPage: Story = { args: { page: 10 } }
export const Numbered: Story = {
  args: { page: 6, pageCount: 12 },
  render: function Render(args) {
    const [page, setPage] = useState(args.page)
    return <Pagination.Numbered {...args} page={page} onPageChange={setPage} />
  },
}
export const NumberedStart: Story = { ...Numbered, args: { page: 1, pageCount: 12 } }
export const NumberedFew: Story = { ...Numbered, args: { page: 2, pageCount: 5 } }
