import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button.js"
import { FormActions } from "./form-actions.js"

const meta = {
  title: "UI/Form Actions",
  component: FormActions.Root,
  args: {
    children: (
      <>
        <Button appearance="ghost">Back</Button>
        <Button appearance="primary">Continue</Button>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormActions.Root>

export default meta

type Story = StoryObj<typeof meta>

export const End: Story = {}
export const Split: Story = { args: { alignment: "split" } }
export const Submit: Story = {
  render: () => (
    <FormActions.Root alignment="split">
      <FormActions.Cancel onClick={() => undefined} />
      <FormActions.Submit pending={false} pendingLabel="Saving…">
        Save changes
      </FormActions.Submit>
    </FormActions.Root>
  ),
}
export const SubmitPending: Story = {
  render: () => (
    <FormActions.Root alignment="split">
      <FormActions.Cancel onClick={() => undefined} disabled />
      <FormActions.Submit pending pendingLabel="Saving…">
        Save changes
      </FormActions.Submit>
    </FormActions.Root>
  ),
}
export const SubmitEnd: Story = {
  render: () => (
    <FormActions.Root>
      <FormActions.Cancel onClick={() => undefined} />
      <FormActions.Submit pending={false} pendingLabel="Saving…">
        Save changes
      </FormActions.Submit>
    </FormActions.Root>
  ),
}
