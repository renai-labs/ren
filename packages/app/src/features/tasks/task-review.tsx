import type { TaskInfo, TaskReviewInput } from "@ren/client"
import { Task } from "@ren/schema/task"
import { TaskComment } from "@ren/schema/task-comment"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Markdown } from "@ren/ui/markdown"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { useMutation } from "@tanstack/react-query"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Tasks } from "./tasks.js"

export function TaskReview(props: { task: TaskInfo }) {
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Alert renders a div; a warning is a status, not an alert
    <Alert role="status">
      <Icon glyph="AlertTriangle" tone="warning" />
      <AlertTitle>Needs review</AlertTitle>
      <div className="col-start-2 flex flex-col gap-4 pt-1">
        <Markdown>{props.task.humanReviewReason ?? "Review this task."}</Markdown>
        {props.task.canUpdate ? <ReviewActions task={props.task} /> : null}
      </div>
    </Alert>
  )
}

function ReviewActions(props: { task: TaskInfo }) {
  const [decision, setDecision] = useState<Task.Decision | null>(null)
  if (decision)
    return <ReviewDecision key={decision} task={props.task} decision={decision} onCancel={() => setDecision(null)} />
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setDecision("approved")}>
        Approve
      </Button>
      <Button variant="outline" onClick={() => setDecision("changes_requested")}>
        Request changes
      </Button>
    </div>
  )
}

function ReviewDecision(props: { task: TaskInfo; decision: Task.Decision; onCancel: () => void }) {
  const context = RouterContext.useRouterContext()
  const review = useMutation(context.api.task.review.mutationOptions())
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
      {error ? (
        <Alert variant="destructive">
          <Icon glyph="AlertCircle" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <form.SubmitButton pendingLabel="Sending decision…">
          {props.decision === "approved" ? "Approve" : "Request changes"}
        </form.SubmitButton>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </Form.Root>
  )
}
