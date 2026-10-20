import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { FindBar } from "@ren/ui/find-bar"
import { Notice } from "@ren/ui/notice"

const meta = {
  component: FindBar,
  args: {
    value: "",
    count: 0,
    active: 0,
    onValueChange: () => undefined,
    onStep: () => undefined,
    onClose: () => undefined,
  },
  render: function Render() {
    const [value, setValue] = useState("")
    const [active, setActive] = useState(0)
    const [closed, setClosed] = useState(false)
    const count = value.trim() ? 3 : 0
    if (closed) return <Notice title="Find closed">Find in chat was closed.</Notice>
    return (
      <FindBar
        value={value}
        onValueChange={(next) => {
          setValue(next)
          setActive(0)
        }}
        count={count}
        active={active}
        onStep={(delta) => setActive((previous) => (previous + delta + count) % count)}
        onClose={() => setClosed(true)}
      />
    )
  },
} satisfies Meta<typeof FindBar>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
