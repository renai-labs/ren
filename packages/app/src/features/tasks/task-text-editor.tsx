import { Button } from "@ren/ui/button"
import { Document } from "@ren/ui/document"
import { Form } from "@ren/ui/form"
import { Notice } from "@ren/ui/notice"
import { Text } from "@ren/ui/text"
import { Schema } from "effect"
import { useState } from "react"
import { Tasks } from "./tasks.js"

export function TaskTextEditor(props: {
  label: string
  value: string
  schema: Schema.Codec<{ readonly value: string }, { readonly value: string }>
  onSave: (value: string) => Promise<unknown>
  onCancel: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const form = Form.useForm({
    defaultValues: { value: props.value },
    schema: Schema.toStandardSchemaV1(props.schema),
    onSubmit: async (value) => {
      setError(null)
      await props.onSave(value.value).then(props.onCancel, (cause: unknown) => setError(Tasks.describe(cause)))
    },
  })
  return (
    <Form.Root form={form} label={props.label}>
      <form.AppField name="value">{(field) => <field.TextArea label={props.label} height="growing" />}</form.AppField>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <form.SubmitButton pendingLabel="Saving…">Save {props.label.toLowerCase()}</form.SubmitButton>
        <Button appearance="plain" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </Form.Root>
  )
}

export function TaskDescription(props: { value: string | null; onSave?: (value: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false)
  if (editing && props.onSave)
    return (
      <TaskTextEditor
        label="Description"
        value={props.value ?? ""}
        schema={descriptionSchema}
        onSave={props.onSave}
        onCancel={() => setEditing(false)}
      />
    )
  return (
    <section aria-label="Description" className="flex flex-col gap-3">
      {props.value ? (
        <Document.Markdown content={props.value} />
      ) : (
        <Text purpose="body" tone="secondary">
          No description yet.
        </Text>
      )}
      {props.onSave ? (
        <div>
          <Button appearance="plain" size="small" onClick={() => setEditing(true)}>
            {props.value ? "Edit description" : "Add description"}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

const descriptionSchema = Schema.Struct({ value: Schema.String })
