import type { Meta, StoryObj } from "@storybook/react-vite"
import { ConfirmationDialog } from "./confirmation-dialog.js"
import { Text } from "./text.js"

const meta = {
  title: "UI/Confirmation Dialog",
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
