import { Dialog } from "ren-v1/composites/dialog"
import type { ConfirmationDialogProps } from "ren-v1/composites/dialog"
import { Text } from "ren-v1/primitives/text"
import meta from "../ui/confirmation-dialog.stories.js"

export default {
  ...meta,
  component: Dialog,
  render: (args: ConfirmationDialogProps) => <Dialog {...args} purpose="confirmation" />,
}

export const WithDetails = {
  args: { children: <Text>Three people are editing this report right now.</Text> },
}

export { Default, Danger, WithoutDescription, Pending, Failing } from "../ui/confirmation-dialog.stories.js"
