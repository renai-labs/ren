import type { ComponentProps } from "react"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ren-v1/composites/dialog"
import { Button } from "ren-v1/primitives/button"
import { Text } from "ren-v1/primitives/text"
import meta from "../../ui/src/components/dialog.stories.js"

const sections = (
  <>
    <DialogHeader>
      <DialogTitle>Rename project</DialogTitle>
      <DialogDescription>Everyone in the workspace sees the new name.</DialogDescription>
    </DialogHeader>
    <DialogBody>
      <Text>The project keeps its history, members and settings.</Text>
    </DialogBody>
    <DialogFooter>
      <DialogClose />
      <Button appearance="primary">Rename project</Button>
    </DialogFooter>
  </>
)

export default {
  ...meta,
  title: "Parity/Dialog",
  component: DialogContent,
  args: { children: sections },
  render: (args: ComponentProps<typeof DialogContent>) => (
    <>
      <Button>Rename project</Button>
      <Dialog open>
        <DialogContent {...args} />
      </Dialog>
    </>
  ),
}

export const SplitFooter = {
  args: {
    children: (
      <>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription visibility="hidden">Everyone in the workspace sees the new name.</DialogDescription>
        </DialogHeader>
        <DialogBody layout="flush">
          <Text>The project keeps its history, members and settings.</Text>
        </DialogBody>
        <DialogFooter alignment="split">
          <DialogClose />
          <Button appearance="primary">Rename project</Button>
        </DialogFooter>
      </>
    ),
  },
}
export const Blocked = {
  render: (args: ComponentProps<typeof DialogContent>) => (
    <>
      <Button>Rename project</Button>
      <Dialog open dismissal="blocked">
        <DialogContent {...args} />
      </Dialog>
    </>
  ),
}

export {
  Default,
  Small,
  Large,
  Wide,
  ExtraLarge,
  ExtraWide,
  Top,
  Compact,
  Standard,
  Tall,
  Side,
  SideLarge,
  SideExtraLarge,
  HiddenCloseButton,
} from "../../ui/src/components/dialog.stories.js"
