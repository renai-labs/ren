import type { Decorator } from "@storybook/react-vite"
import { useEffect, useRef } from "react"
import { Icon } from "@ren/ui/icon"
import { Select } from "ren-v1/primitives/select"
import meta from "../ui/select.stories.js"

export default { ...meta, component: Select }

const opened: Decorator = function Opened(Story) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.querySelector<HTMLElement>('[data-slot="select"]')?.click(), [])
  return (
    <div ref={ref} className="contents">
      <Story />
    </div>
  )
}

export const Open = { args: { value: "opus" }, decorators: [opened] }
export const OptionIcons = {
  args: {
    value: "spend",
    label: "Measure",
    options: [
      { value: "spend", label: "Spend", icon: <Icon glyph="Wallet" /> },
      { value: "events", label: "LLM calls", icon: <Icon glyph="Zap" /> },
    ],
  },
  decorators: [opened],
}

export const Button = {
  render: () => (
    <Select presentation="button" label="Due date" leading={<Icon glyph="Calendar" />}>
      Tomorrow
    </Select>
  ),
}
export const ButtonChip = {
  render: () => (
    <Select presentation="button" label="Labels" appearance="chip" shape="pill" size="small" indicator="none">
      2 labels
    </Select>
  ),
}
export const ButtonSquare = {
  render: () => (
    <Select presentation="button" label="Add label" appearance="plain" shape="square" size="small" indicator="none">
      <Icon glyph="Plus" />
    </Select>
  ),
}
export const ButtonCircle = {
  render: () => (
    <Select presentation="button" label="Assignee" appearance="plain" shape="circle" size="small" indicator="none">
      <Icon glyph="Plus" />
    </Select>
  ),
}
export const ButtonDisabled = {
  render: () => (
    <Select presentation="button" label="Due date" disabled>
      Tomorrow
    </Select>
  ),
}

export {
  Placeholder,
  Selected,
  Filled,
  Plain,
  Inline,
  Property,
  Chip,
  Small,
  Compact,
  Large,
  Pill,
  Fit,
  ChevronUp,
  NoIndicator,
  CompactWidth,
  LimitedWidth,
  Full,
  Leading,
  Disabled,
} from "../ui/select.stories.js"
