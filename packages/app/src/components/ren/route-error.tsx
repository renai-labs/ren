import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router"
import { IconAlertTriangle, IconWifiOff } from "@tabler/icons-react"
import { ClientError } from "@ren/client"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { errorStatus } from "@/lib/api"

const messages: Record<number, string> = {
  400: "The request could not be understood.",
  401: "You need to sign in to view this page.",
  403: "You don’t have permission to view this page.",
  404: "This page could not be found.",
  409: "This change conflicts with the current state.",
  413: "The request was too large to process.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on our end.",
  503: "The service is temporarily unavailable.",
}

function ErrorState(props: {
  title: string
  description: string
  offline?: boolean | undefined
  onRetry?: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{props.offline ? <IconWifiOff /> : <IconAlertTriangle />}</EmptyMedia>
          <EmptyTitle>{props.title}</EmptyTitle>
          <EmptyDescription>{props.description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          {props.onRetry ? (
            <Button variant="outline" onClick={props.onRetry}>
              Try again
            </Button>
          ) : null}
          <Button nativeButton={false} render={<Link to="/" />}>
            Go home
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

export function RouteError(props: ErrorComponentProps) {
  const router = useRouter()
  const retry = () => {
    props.reset()
    void router.invalidate()
  }
  if (props.error instanceof ClientError && props.error.reason === "Transport")
    return (
      <ErrorState
        offline
        title="You’re offline"
        description="Ren can’t reach the server. Check your connection."
        onRetry={retry}
      />
    )
  const status = errorStatus(props.error)
  return (
    <ErrorState
      title={String(status)}
      description={messages[status] ?? messages[500] ?? ""}
      {...(status >= 500 && { onRetry: retry })}
    />
  )
}

export function RouteNotFound() {
  return <ErrorState title="404" description="This page could not be found." />
}
