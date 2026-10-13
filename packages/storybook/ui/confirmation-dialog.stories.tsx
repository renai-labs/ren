import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Text } from "@ren/ui/text"

const meta = {
  component: ConfirmationDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: "Delete ‘Q3 report’?",
    description: "The report and its comments are removed for everyone.",
    onConfirm: () => Promise.resolve(),
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="min-h-dvh">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmationDialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Danger: Story = { args: { tone: "danger", confirmLabel: "Delete report" } }
export const WithoutDescription: Story = { args: { description: undefined } }
export const WithDetails: Story = {
  args: { children: <Text>Three people are editing this report right now.</Text> },
}
export const Pending: Story = { args: { onConfirm: () => new Promise<void>(() => undefined) } }
export const Failing: Story = {
  args: { onConfirm: () => Promise.reject(new Error("Unable to delete the report. Try again.")) },
}
export const FailingWithoutReason: Story = {
  args: {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- this story covers rejections that are not Errors
    onConfirm: () => Promise.reject(new Response(null, { status: 503 })),
  },
}
export const FromTrigger: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(false)
    return (
      <div className="p-4">
        <Button appearance="danger" onClick={() => setOpen(true)}>
          Delete report
        </Button>
        <ConfirmationDialog {...args} open={open} onOpenChange={setOpen} />
      </div>
    )
  },
}
