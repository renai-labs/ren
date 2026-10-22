import { Card } from "@ren/ui/card"
import { StatusDot } from "@ren/ui/status-dot"
import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"

export function TaskSessionCard(props: {
  sessionId: string
  agentName: string | undefined
  mode: "new" | "continue"
  onOpen: (id: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const session = useQuery({
    ...context.api.session.get.queryOptions({ idOrSlug: props.sessionId }),
    refetchInterval: 5000,
  })
  const busy = session.data?.status === "busy"
  return (
    <Card.Root
      title={session.data?.title ?? "Agent session"}
      description={`${props.agentName ?? "Archived agent"} · ${props.mode === "new" ? "New session" : "Continued session"}`}
      metadata={
        session.isError ? (
          "Session unavailable"
        ) : (
          <>
            <StatusDot tone={busy ? "success" : "neutral"} />
            {busy ? "Working" : "Idle"}
          </>
        )
      }
      interaction="button"
      label={`Open session: ${session.data?.title ?? "Agent session"}`}
      onSelect={() => props.onOpen(props.sessionId)}
    />
  )
}
