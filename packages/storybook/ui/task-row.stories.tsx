import type { Meta, StoryObj } from "@storybook/react-vite"
import { TaskRow } from "@ren/ui/task-row"
import { Checkbox } from "@ren/ui/checkbox"
import { TaskSubtaskProgress } from "@ren/ui/task-subtask-progress"
import { TaskTurn } from "@ren/ui/task-turn"
import { List } from "@ren/ui/list"
import { useState } from "react"

const meta = {
  component: TaskRow,
  args: { title: "Plan the migration", onOpen: () => undefined },
  render: function Render(args) {
    const [opened, setOpened] = useState(false)
    const [selected, setSelected] = useState(false)
    return (
      <>
        <List.Group title="Tasks" label="Tasks">
          <TaskRow
            {...args}
            selected={selected}
            onOpen={() => setOpened(true)}
            selection={<Checkbox checked={selected} onCheckedChange={setSelected} label="Select task" />}
          />
        </List.Group>
        <output>{opened ? "Opened task" : "Task list"}</output>
      </>
    )
  },
} satisfies Meta<typeof TaskRow>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Working: Story = { args: { turn: <TaskTurn state="working" name="Build" /> } }
export const Review: Story = { args: { turn: <TaskTurn state="needs_you" reason="Approve the plan" /> } }
export const Parent: Story = { args: { title: "Tasks", badge: <TaskSubtaskProgress done={1} total={3} /> } }
export const Subtask: Story = { args: { title: "Labels", branch: "middle" } }
export const LastSubtask: Story = { args: { title: "Human review", branch: "last" } }
export const SubtaskOutsideItsParent: Story = { args: { title: "Labels", parent: "Tasks and the agent factory" } }
