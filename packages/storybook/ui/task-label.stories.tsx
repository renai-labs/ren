import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskLabel } from "@ren/ui/task-label"

const labels = [
  { id: "lbl_1", name: "frontend", color: "#6f72d9" },
  { id: "lbl_2", name: "ren-fix" },
  { id: "lbl_3", name: "security", color: "#d45f5f" },
  { id: "lbl_4", name: "ren-improve" },
  { id: "lbl_5", name: "onboarding", color: "#2d9b68" },
]

const meta = {
  component: TaskLabel.Pill,
  args: { label: { id: "lbl_1", name: "frontend", color: "#6f72d9" } },
} satisfies Meta<typeof TaskLabel.Pill>

export default meta

type Story = StoryObj<typeof meta>

export const Pill: Story = {}
export const SystemLabel: Story = { args: { label: { id: "lbl_2", name: "ren-fix" } } }
export const Chips: Story = {
  render: () => (
    <div className="flex w-80">
      <TaskLabel.Chips labels={labels.slice(0, 2)} />
    </div>
  ),
}
export const ChipsOverflow: Story = {
  render: () => (
    <div className="flex w-56">
      <TaskLabel.Chips labels={labels} />
    </div>
  ),
}
export const Dots: Story = { render: () => <TaskLabel.Dots labels={labels} /> }
export const Colors: Story = {
  render: () => (
    <div className="flex flex-wrap gap-1">
      {TaskLabel.swatches.map((swatch) => (
        <TaskLabel.Pill key={swatch.hex} label={{ id: swatch.hex, name: swatch.tone, color: swatch.hex }} />
      ))}
    </div>
  ),
}
