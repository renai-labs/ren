import type { Meta, StoryObj } from "@storybook/react-vite"
import { Board } from "@ren/ui/board"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { TaskLabel } from "@ren/ui/task-label"
import { TaskLinkBadge } from "@ren/ui/task-link-badge"
import { TaskPriorityIcon } from "@ren/ui/task-priority-icon"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"
import { TaskTurn } from "@ren/ui/task-turn"
import { Text } from "@ren/ui/text"
import { useState } from "react"

const meta = {
  component: Board.Card,
  args: {
    meta: (
      <Text purpose="code" tone="secondary" element="span">
        RENAI-123
      </Text>
    ),
    leading: <TaskStatusCircle status="in_progress" />,
    title: (
      <Text purpose="body" element="span">
        Add single sign-on for enterprise workspaces
      </Text>
    ),
    turn: <TaskTurn state="working" name="Build" />,
  },
  decorators: [
    (Story) => (
      <div className="grid w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Board.Card>

export default meta

type Story = StoryObj<typeof meta>

const chips = (
  <>
    <TaskPriorityIcon priority="high" />
    <TaskLabel.Pill label={{ id: "lbl_1", name: "security", color: "#d45f5f" }} />
    <TaskLinkBadge link={{ kind: "github_pr", url: "https://github.com/renai-labs/ren/pull/482" }} size="small" />
  </>
)

const actions = (
  <IconButton label="More actions for RENAI-123" size="compact">
    <Icon glyph="MoreHorizontal" />
  </IconButton>
)

export const Card: Story = {}
export const WithoutTurn: Story = { args: { turn: undefined } }
export const Populated: Story = {
  args: {
    turn: undefined,
    chips,
    corner: <Icon glyph="User" tone="secondary" label="Owner Shrey" />,
    footer: <span>Created Oct 20</span>,
    actions,
    pinnedActions: true,
    title: (
      <Button appearance="text" wrapping="normal">
        Add single sign-on for enterprise workspaces
      </Button>
    ),
  },
}
export const PopulatedColumns: Story = {
  ...Populated,
  decorators: [
    (Story) => (
      <div className="flex h-120 w-full">
        <Board.Root label="Task board">
          <Board.Column
            label="Plan"
            header={
              <Text purpose="label" element="h2">
                Plan
              </Text>
            }
          >
            <Story />
          </Board.Column>
          <Board.Column
            label="Build"
            header={
              <Text purpose="label" element="h2">
                Build
              </Text>
            }
          />
        </Board.Root>
      </div>
    ),
  ],
}
export const Navigation: Story = {
  render: function Render(args) {
    const [opened, setOpened] = useState(false)
    const [updated, setUpdated] = useState(false)
    return (
      <>
        <Board.Card
          {...args}
          onOpen={() => setOpened(true)}
          title={
            <Button appearance="text" onClick={() => setOpened(true)}>
              Plan the migration
            </Button>
          }
          actions={<Button onClick={() => setUpdated(true)}>Update task</Button>}
        />
        <output>{opened ? "Opened task" : "Task board"}</output>
        {updated ? <output>Updated task</output> : null}
      </>
    )
  },
}
export const Chips: Story = { args: { chips } }
export const NeedsReview: Story = {
  args: { turn: <TaskTurn state="needs_you" name="Shrey" reason="Ready to merge. QA passed on staging." /> },
}
export const Selected: Story = { args: { selected: true } }
export const Actions: Story = {
  args: {
    footer: <span>Created Oct 20</span>,
    actions,
  },
}
export const PinnedActions: Story = { args: { footer: <span>Created Oct 20</span>, actions, pinnedActions: true } }
export const Corner: Story = { args: { corner: <Icon glyph="User" tone="secondary" label="Owner Shrey" /> } }
export const Columns: Story = {
  decorators: [
    (Story) => (
      <div className="flex h-120 w-full">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <Board.Root label="Task board">
      {[
        { name: "Plan", count: 1, turn: <TaskTurn state="idle" name="Plan" />, status: "todo" as const },
        { name: "Build", count: 1, turn: <TaskTurn state="working" name="Build" />, status: "in_progress" as const },
        { name: "Review", count: 0 },
      ].map((column) => (
        <Board.Column
          key={column.name}
          label={column.name}
          header={
            <>
              <Icon glyph="Bot" tone="secondary" />
              <Text purpose="label" element="span">
                {column.name}
              </Text>
              <Text purpose="caption" element="span" numerals="tabular">
                {column.count}
              </Text>
            </>
          }
        >
          {column.status ? (
            <ul className="space-y-2">
              <li>
                <Board.Card
                  meta={
                    <Text purpose="code" tone="secondary" element="span">
                      RENAI-12{column.count}
                    </Text>
                  }
                  leading={<TaskStatusCircle status={column.status} />}
                  title={
                    <Text purpose="body" element="span">
                      {column.name} the billing export
                    </Text>
                  }
                  turn={column.turn}
                  chips={<TaskPriorityIcon priority="medium" />}
                />
              </li>
            </ul>
          ) : null}
        </Board.Column>
      ))}
    </Board.Root>
  ),
}
