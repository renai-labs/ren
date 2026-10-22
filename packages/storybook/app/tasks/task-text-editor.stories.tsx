import type { Meta, StoryObj } from "@storybook/react-vite"
import { Task } from "@ren/schema/task"
import { Text } from "@ren/ui/text"
import { Schema } from "effect"
import { useRef, useState } from "react"
import { Button } from "@ren/ui/button"
import { TaskDescription, TaskTextEditor } from "../../../app/src/features/tasks/task-text-editor.js"

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

function DescriptionExample() {
  const [value, setValue] = useState("Original description")
  return (
    <>
      <TaskDescription
        value={value}
        onSave={async (next) => {
          setValue(next)
        }}
      />
      <output>Saved: {value}</output>
    </>
  )
}

export const Description: Story = { render: () => <DescriptionExample /> }

function QueuedDescriptionExample() {
  const [value, setValue] = useState("Original description")
  const [history, setHistory] = useState<ReadonlyArray<string>>([])
  const [waiting, setWaiting] = useState(false)
  const complete = useRef<() => void>(() => undefined)
  const first = useRef(true)
  return (
    <>
      <TaskDescription
        value={value}
        onSave={async (next) => {
          if (first.current) {
            first.current = false
            await new Promise<void>((resolve) => {
              complete.current = resolve
              setWaiting(true)
            })
          }
          setValue(next)
          setHistory((previous) => [...previous, next])
        }}
      />
      {waiting ? (
        <Button
          onClick={() => {
            complete.current()
            setWaiting(false)
          }}
        >
          Complete first save
        </Button>
      ) : null}
      <output>{history.join(" → ")}</output>
    </>
  )
}

export const QueuedDescription: Story = { render: () => <QueuedDescriptionExample /> }
