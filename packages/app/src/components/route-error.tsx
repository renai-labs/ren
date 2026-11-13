import { Link, useLocation, useRouter, type ErrorComponentProps } from "@tanstack/react-router"
import type { ReactNode } from "react"
import {
  IconAlertTriangleFilled,
  IconArrowLeft,
  IconCopy,
  IconHourglassFilled,
  IconLockFilled,
  IconRefresh,
  IconSearch,
  IconWifiOff,
  IconX,
} from "@tabler/icons-react"
import { ClientError } from "@ren/client"
import { Button, buttonVariants } from "@ren/ui/button"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import { errorStatus } from "../lib/errors.js"

const places = [
  { prefix: "/tasks/", thing: "task", home: { to: "/tasks", label: "Go to tasks" } },
  { prefix: "/sessions/", thing: "chat", home: { to: "/", label: "Start a new chat" } },
  { prefix: "/spaces/", thing: "space", home: { to: "/spaces", label: "Go to spaces" } },
  { prefix: "/automations", thing: "page", home: { to: "/automations", label: "Go to automations" } },
  { prefix: "/settings", thing: "page", home: { to: "/settings/preferences", label: "Go to settings" } },
] as const

const fallbackPlace = { thing: "page", home: { to: "/", label: "Go home" } } as const

function usePlace() {
  const path = useLocation({ select: (location) => location.pathname })
  return places.find((place) => path.startsWith(place.prefix)) ?? fallbackPlace
}

function PageCard(props: { children: ReactNode; badge?: ReactNode; stacked?: boolean }) {
  return (
    <div className="relative">
      <div className="absolute inset-0 translate-x-3 -translate-y-2 rotate-6 rounded-xl border bg-muted/40" />
      {props.stacked ? (
        <div className="absolute inset-0 -translate-x-3 -translate-y-1 -rotate-6 rounded-xl border bg-muted/40" />
      ) : null}
      <div className="relative flex h-28 w-44 overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex w-8 shrink-0 flex-col gap-1.5 border-r bg-muted/50 p-2">
          <span className="h-1 rounded-full bg-muted-foreground/25" />
          <span className="h-1 rounded-full bg-muted-foreground/15" />
          <span className="h-1 rounded-full bg-muted-foreground/15" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-2.5">
          <span className="h-1.5 w-12 rounded-full bg-muted-foreground/25" />
          <div className="flex flex-1 items-center justify-center rounded-md bg-muted text-muted-foreground/60">
            {props.children}
          </div>
        </div>
      </div>
      {props.badge ? (
        <span className="absolute -right-3 -bottom-3 flex size-10 items-center justify-center rounded-full border bg-background shadow-sm [&_svg]:size-5">
          {props.badge}
        </span>
      ) : null}
    </div>
  )
}

function Code(props: { children: string }) {
  return <span className="text-3xl font-semibold tracking-tight tabular-nums">{props.children}</span>
}

function SadFace() {
  return (
    <span className="flex flex-col items-center gap-1">
      <span className="flex gap-3">
        <IconX className="size-5" stroke={2.5} />
        <IconX className="size-5" stroke={2.5} />
      </span>
      <span className="h-2 w-6 rounded-t-full border-x-2 border-t-2 border-current" />
    </span>
  )
}

function Ripples(props: { children: ReactNode }) {
  return (
    <div className="relative flex size-36 items-center justify-center">
      {[
        "inset-0 border-muted-foreground/15",
        "inset-5 border-muted-foreground/25",
        "inset-10 border-muted-foreground/40",
      ].map((ring) => (
        <span key={ring} className={cn("absolute rounded-full border-2 border-dashed", ring)} />
      ))}
      <span className="relative flex size-14 items-center justify-center rounded-full border bg-card text-chart-4 shadow-sm">
        {props.children}
      </span>
    </div>
  )
}

const art = {
  "404": (
    <PageCard badge={<IconSearch className="text-chart-1" />}>
      <Code>404</Code>
    </PageCard>
  ),
  "403": (
    <PageCard badge={<IconLockFilled className="text-chart-3" />}>
      <Code>403</Code>
    </PageCard>
  ),
  "429": (
    <PageCard stacked badge={<IconHourglassFilled className="text-chart-1" />}>
      <Code>429</Code>
    </PageCard>
  ),
  "500": (
    <PageCard badge={<IconAlertTriangleFilled className="text-chart-4" />}>
      <SadFace />
    </PageCard>
  ),
  offline: (
    <Ripples>
      <IconWifiOff className="size-6" />
    </Ripples>
  ),
}

function ErrorState(props: {
  art: ReactNode
  code?: string | undefined
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode | undefined
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm animate-in flex-col items-center text-center duration-300 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:slide-in-from-bottom-0">
        <div className="mb-8 flex h-36 items-center justify-center">{props.art}</div>
        {props.code ? <p className="mb-1.5 text-xs text-muted-foreground tabular-nums">{props.code}</p> : null}
        <h1 className="text-lg font-medium text-balance">{props.title}</h1>
        <p className="mt-1.5 text-sm text-balance text-muted-foreground">{props.description}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{props.children}</div>
        {props.footer ? <div className="mt-4">{props.footer}</div> : null}
      </div>
    </div>
  )
}

function BackButton() {
  const router = useRouter()
  return (
    <Button variant="ghost" onClick={() => router.history.back()}>
      <IconArrowLeft data-icon="inline-start" />
      Go back
    </Button>
  )
}

function PlaceLink(props: { place: { readonly home: { readonly to: string; readonly label: string } } }) {
  return (
    <Link to={props.place.home.to} className={buttonVariants()}>
      {props.place.home.label}
    </Link>
  )
}

function CopyDetails(props: { error: unknown; status: number }) {
  const path = useLocation({ select: (location) => location.href })
  const detailsOf = () =>
    [
      `Status: ${props.status}`,
      `Page: ${path}`,
      props.error instanceof Error
        ? `Error: ${props.error.name}: ${props.error.message}`
        : `Error: ${String(props.error)}`,
      `Time: ${new Date().toISOString()}`,
    ].join("\n")

  return (
    <Button
      variant="link"
      size="sm"
      className="text-muted-foreground"
      onClick={() =>
        void navigator.clipboard.writeText(detailsOf()).then(
          () => toast.success("Error details copied"),
          () => toast.error("Couldn’t copy the details"),
        )
      }
    >
      <IconCopy data-icon="inline-start" />
      Copy error details
    </Button>
  )
}

function MissingState(props: { forbidden: boolean }) {
  const place = usePlace()
  const thing = place.thing
  if (props.forbidden)
    return (
      <ErrorState
        art={art["403"]}
        title={`You don’t have access to this ${thing}`}
        description={`Ask someone who can open this ${thing} to add you, or check that you’re in the right organization.`}
      >
        <BackButton />
        <PlaceLink place={place} />
      </ErrorState>
    )
  return (
    <ErrorState
      art={art["404"]}
      title={thing === "page" ? "Page not found" : `This ${thing} doesn’t exist`}
      description="It may have been deleted or moved, or the link is wrong."
    >
      <BackButton />
      <PlaceLink place={place} />
    </ErrorState>
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
        art={art.offline}
        title="You’re offline"
        description="Ren can’t reach the server. Check your connection, then try again."
      >
        <Button onClick={retry}>
          <IconRefresh data-icon="inline-start" />
          Try again
        </Button>
      </ErrorState>
    )
  const status = errorStatus(props.error)
  if (status === 404 || status === 403) return <MissingState forbidden={status === 403} />
  if (status === 429)
    return (
      <ErrorState
        art={art["429"]}
        title="Slow down a moment"
        description="Ren got too many requests at once. Wait a few seconds, then try again."
      >
        <Button onClick={retry}>
          <IconRefresh data-icon="inline-start" />
          Try again
        </Button>
      </ErrorState>
    )
  return (
    <ErrorState
      art={art["500"]}
      code={`Error ${status}`}
      title="This page didn’t load"
      description="Ren hit a problem loading this page. Try again, and if it keeps happening, send us the details."
      footer={<CopyDetails error={props.error} status={status} />}
    >
      <Link to="/" className={buttonVariants({ variant: "ghost" })}>
        Go home
      </Link>
      <Button onClick={retry}>
        <IconRefresh data-icon="inline-start" />
        Try again
      </Button>
    </ErrorState>
  )
}

export function RouteNotFound() {
  return <MissingState forbidden={false} />
}
