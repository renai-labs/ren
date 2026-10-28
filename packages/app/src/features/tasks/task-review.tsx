import type { TaskInfo, TaskReviewInput } from "@ren/client"
import { Task } from "@ren/schema/task"
import { TaskComment } from "@ren/schema/task-comment"
import { Button } from "@ren/ui/button"
import { Document } from "@ren/ui/document"
import { Form } from "@ren/ui/form"
import { Notice } from "@ren/ui/notice"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Tasks } from "./tasks.js"

export function TaskReview(props: { task: TaskInfo }) {
  return (
    <Notice tone="warning" title="Needs review">
      <div className="flex flex-col gap-4">
        <Document.Markdown content={props.task.humanReviewReason ?? "Review this task."} />
        {props.task.canUpdate ? <ReviewActions task={props.task} /> : null}
      </div>
    </Notice>
  )
}

function ReviewActions(props: { task: TaskInfo }) {
  const [decision, setDecision] = useState<Task.Decision | null>(null)
  if (decision)
    return <ReviewDecision key={decision} task={props.task} decision={decision} onCancel={() => setDecision(null)} />
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setDecision("approved")}>Approve</Button>
      <Button appearance="outline" onClick={() => setDecision("changes_requested")}>
        Request changes
      </Button>
    </div>
  )
}

function ReviewDecision(props: { task: TaskInfo; decision: Task.Decision; onCancel: () => void }) {
  const context = RouterContext.useRouterContext()
  const review = Tasks.useTaskMutation(context.api.task.review.mutationOptions())
  return (
    <ReviewDecisionForm
      decision={props.decision}
      onSubmit={(payload) => review.mutateAsync({ id: props.task.id, payload })}
      onCancel={props.onCancel}
    />
  )
}

const schemas = {
  approved: Schema.Struct({
    comment: Task.ReviewInput.members[1].fields.comment,
    start: Schema.Literals(["default", "continue", "none"]),
  }),
  changes_requested: Schema.Struct({
    comment: TaskComment.Body,
    start: Schema.Literals(["default", "continue", "none"]),
  }),
}

function ReviewDecisionForm(props: {
  decision: Task.Decision
  onSubmit: (input: Extract<TaskReviewInput["payload"], { humanReview: false }>) => Promise<unknown>
  onCancel: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const form = Form.useForm({
    defaultValues: { comment: "", start: "default" },
    schema: Schema.toStandardSchemaV1(schemas[props.decision]),
    onSubmit: async (value) => {
      setError(null)
      await props
        .onSubmit({
          humanReview: false,
          decision: props.decision,
          ...(value.comment?.trim() && { comment: value.comment }),
          ...(value.start !== "default" && { start: value.start }),
        })
        .then(props.onCancel, (cause: unknown) => setError(Tasks.describe(cause)))
    },
  })
  return (
    <Form.Root form={form} label={props.decision === "approved" ? "Approve review" : "Request changes"}>
      <form.AppField name="comment">
        {(field) => (
          <field.TextArea label={props.decision === "approved" ? "Comment (optional)" : "What needs to change?"} />
        )}
      </form.AppField>
      <form.AppField name="start">
        {(field) => (
          <field.Select
            label="After review"
            options={[
              { value: "default", label: "Use default" },
              { value: "continue", label: "Continue agent" },
              { value: "none", label: "Keep agent idle" },
            ]}
          />
        )}
      </form.AppField>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <form.SubmitButton pendingLabel="Sending decision…">
          {props.decision === "approved" ? "Approve" : "Request changes"}
        </form.SubmitButton>
        <Button appearance="plain" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </Form.Root>
  )
}
