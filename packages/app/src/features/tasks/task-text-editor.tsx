import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Markdown } from "@ren/ui/markdown"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { Textarea } from "@ren/ui/textarea"
import { MarkdownEditor } from "@ren/ui/markdown-editor"
import { Task } from "@ren/schema/task"
import { Autosave } from "../../lib/autosave.js"
import { Schema } from "effect"
import { useRef, useState } from "react"
import { Tasks } from "./tasks.js"

export function TaskTitleEditor(props: { value: string; onSave?: (value: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState(props.value)
  const [received, setReceived] = useState(props.value)
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const discard = useRef(false)
  if (received !== props.value && !focused) {
    setReceived(props.value)
    setDraft(props.value)
  }
  if (!props.onSave)
    return (
      <Text purpose="title" element="h1">
        {props.value}
      </Text>
    )
  const commit = async () => {
    const next = draft.replaceAll(/\s+/g, " ").trim()
    if (!next) {
      setDraft(props.value)
      return
    }
    if (next === props.value || saving || !props.onSave) return
    setSaving(true)
    setError(null)
    await props.onSave(next).then(
      () => setDraft(next),
      (cause: unknown) => setError(Tasks.describe(cause)),
    )
    setSaving(false)
  }
  return (
    <div className="flex flex-col gap-2">
      <Text purpose="title" element="h1">
        <Textarea
          className="min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-title/title font-medium tracking-tight focus-visible:ring-0 md:text-title/title"
          aria-label="Task title"
          value={draft}
          rows={1}
          maxLength={Task.maximumTitleLength}
          disabled={saving}
          aria-invalid={error !== null}
          onChange={(event) => setDraft(event.target.value.replaceAll(/\s*\n\s*/g, " "))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (discard.current) {
              discard.current = false
              return
            }
            void commit()
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === "Escape") {
              event.preventDefault()
              discard.current = true
              setDraft(props.value)
              setError(null)
              event.currentTarget.blur()
            }
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      </Text>
      {error ? (
        <Alert variant="destructive">
          <Icon glyph="AlertCircle" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

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
      {error ? (
        <Alert variant="destructive">
          <Icon glyph="AlertCircle" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <form.SubmitButton pendingLabel="Saving…">Save {props.label.toLowerCase()}</form.SubmitButton>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </Form.Root>
  )
}

export function TaskDescription(props: { value: string | null; onSave?: (value: string) => Promise<unknown> }) {
  if (props.onSave) return <DescriptionEditor value={props.value ?? ""} onSave={props.onSave} />
  return (
    <section aria-label="Description" className="flex flex-col gap-3">
      {props.value ? (
        <Markdown>{props.value}</Markdown>
      ) : (
        <Text purpose="body" tone="secondary">
          No description yet.
        </Text>
      )}
    </section>
  )
}

function DescriptionEditor(props: { value: string; onSave: (value: string) => Promise<unknown> }) {
  const editor = Autosave.useText(props.value, props.onSave)
  return (
    <section aria-label="Description" className="flex flex-col gap-3">
      <MarkdownEditor
        value={editor.draft}
        onChange={editor.change}
        label="Task description"
        placeholder="Add description…"
      />
      {editor.pending ? (
        <output aria-label="Saving description…" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden />
        </output>
      ) : null}
      {editor.error ? (
        <Alert variant="destructive" className="has-data-[slot=alert-action]:pr-52">
          <Icon glyph="AlertCircle" />
          <AlertDescription>{editor.error}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="sm" onClick={editor.retry}>
              Retry saving description
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
    </section>
  )
}
