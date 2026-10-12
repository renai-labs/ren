import { useState } from "react"
import type { ComponentProps } from "react"
import { EditableValue } from "ren-v1/composites/controls"
import meta from "../../ui/src/components/inline-edit.stories.js"

export default {
  ...meta,
  title: "Parity/Inline Edit",
  component: EditableValue,
  render: function Render(args: Extract<ComponentProps<typeof EditableValue>, { onCommit: unknown }>) {
    const [value, setValue] = useState(args.value)
    return <EditableValue {...args} value={value} onCommit={setValue} />
  },
}

export {
  Default,
  Empty,
  EndAligned,
  Required,
  LongValue,
  Validated,
} from "../../ui/src/components/inline-edit.stories.js"
