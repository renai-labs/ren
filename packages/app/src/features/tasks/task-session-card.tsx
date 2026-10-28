import { Card } from "@ren/ui/card"
import { StatusDot } from "@ren/ui/status-dot"
import { Button } from "@ren/ui/button"
import { Notice } from "@ren/ui/notice"
import { Text } from "@ren/ui/text"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { SessionSummary } from "../../lib/session-summary.js"
import { Tasks } from "./tasks.js"

const modes = { new: "New session", continue: "Continued session", created: "Session that created this task" }

export function TaskSessionCard(props: {
  sessionId: string
  agentName: string | undefined
  mode: "new" | "continue" | "created"
  onOpen: (id: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const client = useQueryClient()
  const session = useQuery({
    ...context.api.session.get.queryOptions({ idOrSlug: props.sessionId }),
    refetchInterval: 5000,
  })
  const busy = session.data?.status === "busy"
  const preview = useQuery({ ...SessionSummary.previewOptions(context, props.sessionId), enabled: session.isSuccess })
  const stop = useMutation({
    mutationFn: async () => {
      const chat = await SessionSummary.client(context, props.sessionId)
      if (!chat) throw new Error("The session is not running.")
      return chat.session.interrupt({ sessionID: props.sessionId })
    },
    onSuccess: () =>
      Promise.all(
        [
          context.api.session.get.queryKey({ idOrSlug: props.sessionId }),
          context.api.task.get.queryKey(),
          context.api.task.list.queryKey(),
        ].map((queryKey) =>
          // ast-grep-ignore: no-manual-invalidation -- stopping goes through the chat client, not a generated mutation
          client.invalidateQueries({ queryKey }),
        ),
      ),
  })
  return (
    <div className="flex flex-col gap-2">
      <Card.Root
        title={session.data?.title ?? "Agent session"}
        description={<Description agentName={props.agentName} mode={props.mode} preview={preview.data} />}
        metadata={<Status status={session.status} busy={busy} />}
        interaction="button"
        label={`Open session: ${session.data?.title ?? "Agent session"}`}
        {...(!session.isError && { onSelect: () => props.onOpen(props.sessionId) })}
        actions={
          busy && session.data?.capabilities.interrupt ? (
            <Button
              appearance="outline"
              size="small"
              pending={stop.isPending}
              pendingLabel="Stopping…"
              onClick={() => stop.mutate()}
            >
              Stop session
            </Button>
          ) : undefined
        }
      />
      {stop.error ? <Notice tone="danger">{Tasks.describe(stop.error)}</Notice> : null}
    </div>
  )
}

function Description(props: { agentName: string | undefined; mode: keyof typeof modes; preview: string | undefined }) {
  return (
    <>
      <Text purpose="body">
        {props.agentName ?? "Archived agent"} · {modes[props.mode]}
      </Text>
      {props.preview ? (
        <Text purpose="body" truncation="single-line" title={props.preview}>
          {props.preview}
        </Text>
      ) : null}
    </>
  )
}

function Status(props: { status: "error" | "pending" | "success"; busy: boolean }) {
  if (props.status === "error") return "Session unavailable"
  if (props.status === "pending") return "Loading session…"
  return (
    <>
      <StatusDot tone={props.busy ? "success" : "neutral"} />
      {props.busy ? "Working" : "Idle"}
    </>
  )
}
