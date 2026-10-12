import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@ren/ui/button"
import { Dialog } from "@ren/ui/dialog"
import { Text } from "@ren/ui/text"

const sections = (
  <>
    <Dialog.Header>
      <Dialog.Title>Rename project</Dialog.Title>
      <Dialog.Description>Everyone in the workspace sees the new name.</Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      <Text>The project keeps its history, members and settings.</Text>
    </Dialog.Body>
    <Dialog.Footer>
      <Dialog.Close />
      <Button appearance="primary">Rename project</Button>
    </Dialog.Footer>
  </>
)

const meta = {
  component: Dialog.Content,
  args: { children: sections },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="min-h-dvh p-4">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Dialog.Root defaultOpen>
      <Dialog.Trigger>
        <Button>Rename project</Button>
      </Dialog.Trigger>
      <Dialog.Content {...args} />
    </Dialog.Root>
  ),
} satisfies Meta<typeof Dialog.Content>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Small: Story = { args: { size: "small" } }
export const Large: Story = { args: { size: "large" } }
export const Wide: Story = { args: { size: "wide" } }
export const ExtraLarge: Story = { args: { size: "extra-large" } }
export const ExtraWide: Story = { args: { size: "extra-wide" } }
export const Top: Story = { args: { placement: "top" } }
export const Compact: Story = { args: { height: "compact" } }
export const Standard: Story = { args: { height: "standard" } }
export const Tall: Story = { args: { height: "tall" } }
export const Side: Story = { args: { presentation: "side" } }
export const SideLarge: Story = { args: { presentation: "side", size: "large" } }
export const SideExtraLarge: Story = { args: { presentation: "side", size: "extra-large" } }
export const HiddenCloseButton: Story = { args: { closeButton: "hidden" } }
export const SplitFooter: Story = {
  args: {
    children: (
      <>
        <Dialog.Header>
          <Dialog.Title>Rename project</Dialog.Title>
          <Dialog.Description visibility="hidden">Everyone in the workspace sees the new name.</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body layout="flush">
          <Text>The project keeps its history, members and settings.</Text>
        </Dialog.Body>
        <Dialog.Footer alignment="split">
          <Dialog.Close />
          <Button appearance="primary">Rename project</Button>
        </Dialog.Footer>
      </>
    ),
  },
}
export const Closed: Story = {
  render: (args) => (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button>Rename project</Button>
      </Dialog.Trigger>
      <Dialog.Content {...args} />
    </Dialog.Root>
  ),
}
export const Blocked: Story = {
  render: (args) => (
    <Dialog.Root defaultOpen dismissal="blocked">
      <Dialog.Trigger>
        <Button>Rename project</Button>
      </Dialog.Trigger>
      <Dialog.Content {...args} />
    </Dialog.Root>
  ),
}
export const Alert: Story = {
  render: (args) => (
    <Dialog.AlertRoot defaultOpen>
      <Dialog.Trigger>
        <Button>Archive project</Button>
      </Dialog.Trigger>
      <Dialog.Content {...args} />
    </Dialog.AlertRoot>
  ),
}
