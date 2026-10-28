import { ClientError } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Logotype } from "@ren/ui/logotype"
import { PublicShell } from "@ren/ui/public-shell"
import { Link, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"

const messages: Record<number, string> = {
  400: "The request could not be understood.",
  401: "You need to sign in to view this page.",
  403: "You don’t have permission to view this page.",
  404: "This page could not be found.",
  408: "The request took too long to complete.",
  409: "This change conflicts with the current state.",
  410: "This page is no longer available.",
  413: "The request was too large to process.",
  422: "The request could not be processed.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on our end.",
  502: "The server returned an invalid response.",
  503: "The service is temporarily unavailable.",
  504: "The server took too long to respond.",
}

const statuses: Record<string, number> = {
  InvalidRequestError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  TooLargeError: 413,
  UnavailableError: 503,
}

function ErrorPage(props: { code: string; message: string; action?: ReactNode }) {
  return (
    <PublicShell.Status brand={<Logotype size="large" tone="subdued" />} title={props.code} description={props.message}>
      {props.action ?? (
        <Button appearance="primary" nativeButton={false} render={<Link to="/" />}>
          Go to homepage
        </Button>
      )}
    </PublicShell.Status>
  )
}

export function RouteError(props: { error: unknown }) {
  if (props.error instanceof ClientError && props.error.reason === "Transport") return <OfflineError />
  const status = statusOf(props.error)
  const message =
    messages[status] ?? (status >= 400 && status < 500 ? "The request could not be completed." : messages[500])
  return <ErrorPage code={String(status)} message={message ?? ""} />
}

export function RouteNotFound() {
  return <ErrorPage code="404" message="This page could not be found." />
}

function statusOf(error: unknown) {
  if (error instanceof ClientError && error.reason === "UnexpectedStatus") {
    const cause = error.cause
    if (typeof cause === "object" && cause !== null && "status" in cause && typeof cause.status === "number") {
      return cause.status
    }
  }
  if (error instanceof Error) return statuses[error.name] ?? 500
  return 500
}

function OfflineError() {
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)
  return (
    <ErrorPage
      code="Offline"
      message={retrying ? "Reconnecting…" : "Can’t reach Ren. We’ll reconnect automatically."}
      action={
        <Button
          appearance="primary"
          pending={retrying}
          onClick={() => {
            setRetrying(true)
            void router.invalidate().finally(() => setRetrying(false))
          }}
        >
          Try again
        </Button>
      }
    />
  )
}
