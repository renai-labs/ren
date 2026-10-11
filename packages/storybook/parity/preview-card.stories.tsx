import type { ComponentProps } from "react"
import { Button } from "../../ui/src/components/button.js"
import { Text } from "../../ui/src/components/text.js"
import { Popover } from "ren-v1/composites/popover"
import meta from "../../ui/src/components/preview-card.stories.js"

export default { ...meta, title: "Parity/Preview Card", component: Popover }

const opened = (args: Partial<ComponentProps<typeof Popover>>) => ({
  render: () => (
    <Popover activation="hover" trigger={<Button appearance="outline">Design review</Button>} open {...args}>
      <Text>Design review · 4 open tasks, last updated 2 hours ago.</Text>
    </Popover>
  ),
})

export const Closed = {
  render: () => (
    <Popover activation="hover" trigger={<Button appearance="outline">Design review</Button>}>
      <Text>Design review · 4 open tasks, last updated 2 hours ago.</Text>
    </Popover>
  ),
}
export const Open = opened({})
export const Top = opened({ placement: "top" })
export const Right = opened({ placement: "right", padding: "small" })
export const AlignedEnd = opened({ alignment: "end" })
export const LargePadding = opened({ padding: "large" })
