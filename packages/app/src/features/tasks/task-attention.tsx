import type { TaskInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Notice } from "@ren/ui/notice"
import { TaskTurn } from "@ren/ui/task-turn"
import type { TaskTurnProps } from "@ren/ui/task-turn"
import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { SessionSummary } from "../../lib/session-summary.js"
import { TaskView } from "./task-view.js"

function useAttention(task: TaskInfo) {
  const context = RouterContext.useRouterContext()
  const enabled = task.session !== null && TaskView.isActionable(task)
  const query = useQuery({ ...SessionSummary.attentionOptions(context, task.session?.id ?? ""), enabled })
  const attention = enabled ? query.data : undefined
  return {
    form: attention?.form,
    permission: attention?.permission,
    reason: attention?.form?.title ?? (attention?.permission ? "Permission needed" : undefined),
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
    <Notice
      tone="warning"
      title={attention.form ? "Needs you" : "Permission needed"}
      action={
        <Button onClick={() => props.onOpen(session.id)}>{attention.form ? "Answer" : "Review permission"}</Button>
      }
    >
      {attention.form?.title ?? attention.permission?.message ?? attention.permission?.action}
    </Notice>
  )
}
