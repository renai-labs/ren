import type { TaskInfo } from "@ren/client"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { TaskTurn } from "@ren/ui/task-turn"
import type { TaskTurnProps } from "@ren/ui/task-turn"
import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { SessionSummary } from "../../lib/session-summary.js"
import { TaskView } from "./task-view.js"

function useAttention(task: TaskInfo) {
  const context = RouterContext.useRouterContext()
  const enabled = task.session?.state === "working" && TaskView.isActionable(task)
  const query = useQuery({ ...SessionSummary.attentionOptions(context, task.session?.id ?? ""), enabled })
  const attention = enabled ? query.data : undefined
  return {
    form: attention?.form,
    permission: attention?.permission,
    reason: attention?.reason,
  }
}

export function AttentionTurn(props: { task: TaskInfo; owner: string | undefined; turn: TaskTurnProps }) {
  const attention = useAttention(props.task)
  if (props.task.humanReview || attention.reason === undefined) return <TaskTurn {...props.turn} />
  return <TaskTurn {...props.turn} state="needs_you" name={props.owner} reason={attention.reason} />
}

export function AttentionNotice(props: { task: TaskInfo; onOpen: (id: string) => void }) {
  const attention = useAttention(props.task)
  const session = props.task.session
  if (!session || attention.reason === undefined) return null
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Alert renders a div; a warning is a status, not an alert
    <Alert role="status" className="has-data-[slot=alert-action]:pr-40">
      <Icon glyph="AlertTriangle" tone="warning" />
      <AlertTitle>{attention.form ? "Needs you" : "Permission needed"}</AlertTitle>
      <AlertDescription>
        {attention.form?.title ?? attention.permission?.message ?? attention.permission?.action}
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={() => props.onOpen(session.id)}>
          {attention.form ? "Answer" : "Review permission"}
        </Button>
      </AlertAction>
    </Alert>
  )
}
