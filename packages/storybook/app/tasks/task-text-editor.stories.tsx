import type { Meta, StoryObj } from "@storybook/react-vite"
import { Task } from "@ren/schema/task"
import { Text } from "@ren/ui/text"
import { Schema } from "effect"
import { useState } from "react"
import { TaskTextEditor } from "../../../app/src/features/tasks/task-text-editor.js"

const title = Schema.Struct({ value: Task.Title })

function EditorExample() {
  const [saved, setSaved] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  if (closed) return <Text purpose="body">{saved === null ? "Edit cancelled" : `Saved: ${saved}`}</Text>
  return (
    <TaskTextEditor
      label="Title"
      value="Plan the migration"
      schema={title}
      onSave={async (value) => {
        setSaved(value)
      }}
      onCancel={() => setClosed(true)}
    />
  )
}

const meta = { component: EditorExample } satisfies Meta<typeof EditorExample>
export default meta
type Story = StoryObj<typeof meta>
export const Title: Story = { render: () => <EditorExample /> }
