import type { StoryObj } from "@storybook/react-vite"
import { FormActions } from "ren-v1/composites/field"
import meta from "../../ui/src/components/form-actions.stories.js"

export default { ...meta, title: "Parity/Form Actions", component: FormActions }

type Story = StoryObj<typeof FormActions>

export { End, Split } from "../../ui/src/components/form-actions.stories.js"

export const Submit: Story = {
  render: () => (
    <FormActions onCancel={() => undefined} pending={false} pendingLabel="Saving…">
      Save changes
    </FormActions>
  ),
}
export const SubmitPending: Story = {
  render: () => (
    <FormActions onCancel={() => undefined} pending pendingLabel="Saving…">
      Save changes
    </FormActions>
  ),
}
export const SubmitEnd: Story = {
  render: () => (
    <FormActions alignment="end" onCancel={() => undefined} pending={false} pendingLabel="Saving…">
      Save changes
    </FormActions>
  ),
}
