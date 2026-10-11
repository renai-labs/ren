import type { ComponentProps } from "react"
import { Button } from "../../ui/src/components/button.js"
import { Text } from "../../ui/src/components/text.js"
import { Popover } from "ren-v1/composites/popover"
import meta from "../../ui/src/components/popover.stories.js"

export default { ...meta, title: "Parity/Popover", component: Popover }

const opened = (args: Partial<ComponentProps<typeof Popover>>) => ({
  render: () => (
    <Popover trigger={<Button appearance="outline">Display</Button>} label="Task display" open {...args}>
      <Text>Group tasks by status, assignee or label, and choose which properties each row shows.</Text>
    </Popover>
  ),
})

export const Closed = {
  render: () => (
    <Popover trigger={<Button appearance="outline">Display</Button>} label="Task display">
      <Text>Group tasks by status, assignee or label, and choose which properties each row shows.</Text>
    </Popover>
  ),
}
export const Open = opened({})
export const Top = opened({ placement: "top" })
export const Right = opened({ placement: "right" })
export const AlignedEnd = opened({ alignment: "end" })
export const SmallPadding = opened({ padding: "small" })
export const LargePadding = opened({ padding: "large" })
