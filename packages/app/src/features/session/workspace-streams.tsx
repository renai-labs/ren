import { type ReactNode, useState } from "react"
import type { ChatAtoms } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import {
  IconArrowLeft,
  IconArrowRight,
  IconDeviceDesktop,
  IconHandFinger,
  IconRefresh,
  IconWorld,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Progress } from "@ren/ui/progress"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { AsyncResult } from "effect/reactivity"
import { errorMessage } from "../../lib/errors.js"
import { useLiveView } from "../../lib/use-live-view.js"

function Waiting(props: { icon: ReactNode; title: string; description: string }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-6">{props.icon}</EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function Playback(props: { label: string; live?: boolean }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3">
      <Progress value={0} aria-label={`${props.label} timeline`} className="h-1" />
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Step back" disabled className="text-muted-foreground">
          <IconArrowLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Step forward" disabled className="text-muted-foreground">
          <IconArrowRight />
        </Button>
        <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <span
            className={props.live ? "size-1.5 rounded-full bg-chart-2" : "size-1.5 rounded-full bg-muted-foreground/60"}
          />
          {props.live ? "Live" : "Offline"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Take control"
          disabled
          className="ml-auto text-muted-foreground"
        >
          <IconHandFinger />
        </Button>
      </div>
    </div>
  )
}

export function ComputerTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <Waiting
          icon={<IconDeviceDesktop />}
          title="Computer"
          description="The environment’s desktop streams here once it’s connected."
        />
      </div>
      <Playback label="Computer" />
    </div>
  )
}

function Failed(props: { onRetry: () => void }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
          <IconWorld />
        </EmptyMedia>
        <EmptyTitle>Ren couldn’t show the browser</EmptyTitle>
        <EmptyDescription>The connection to the browser stopped.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={props.onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function LiveView(props: { src: string; title: string; onRetry: () => void }) {
  const status = useLiveView(props.src)
  if (status === "failed") return <Failed onRetry={props.onRetry} />
  return (
    <div className="relative size-full">
      <iframe
        src={props.src}
        title={props.title}
        // oxlint-disable-next-line react/iframe-missing-sandbox -- The live view is on Kernel's origin, so it cannot reach this page; its client needs its own storage.
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="origin"
        allow="autoplay; clipboard-read; clipboard-write"
        className="size-full border-0 bg-muted"
      />
      {status === "playing" ? null : (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <Spinner className="text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

const addressOf = (typed: string) =>
  /^[a-z][a-z\d+.-]*:\/\//i.test(typed) || typed.startsWith("about:") ? typed : `https://${typed}`

function BrowserBody(props: { view: ChatAtoms.BrowserView | undefined; onRetry: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const view = props.view
  const retry = () => {
    setAttempt(attempt + 1)
    props.onRetry()
  }
  if (!view || view.status === "none")
    return (
      <Waiting
        icon={<IconWorld />}
        title="Browser"
        description="The pages Ren opens in its cloud browser stream here."
      />
    )
  if (view.status === "closed")
    return (
      <Waiting icon={<IconWorld />} title="Browser closed" description="Ren closed the browser, or it timed out." />
    )
  if (view.status === "failed") return <Failed onRetry={retry} />
  return <LiveView key={attempt} src={view.info.liveView} title={view.info.title || "Browser"} onRetry={retry} />
}

export function BrowserTab(props: { root: Session.ID }) {
  const browser = ChatReact.useBrowser(props.root)
  const navigate = ChatReact.useBrowserNavigate(props.root)
  const view = AsyncResult.getOrElse(browser.result, () => undefined)
  const info = view && "info" in view ? view.info : undefined
  const live = view?.status === "live"
  const [typed, setTyped] = useState<string>()
  const go = (to: Parameters<typeof navigate>[0]) =>
    void navigate(to).catch((error: unknown) =>
      toast.error("Couldn’t open the page", { description: errorMessage(error) }),
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex shrink-0 items-center gap-1 px-3 pb-2"
        onSubmit={(event) => {
          event.preventDefault()
          const url = typed?.trim()
          if (!url) return
          setTyped(undefined)
          go({ url: addressOf(url) })
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back"
          disabled={!live || !info?.canGoBack}
          className="text-muted-foreground"
          onClick={() => go({ history: "back" })}
        >
          <IconArrowLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Forward"
          disabled={!live || !info?.canGoForward}
          className="text-muted-foreground"
          onClick={() => go({ history: "forward" })}
        >
          <IconArrowRight />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Reload"
          disabled={!live}
          className="text-muted-foreground"
          onClick={() => go({ history: "reload" })}
        >
          <IconRefresh />
        </Button>
        <InputGroup className="flex-1 border-transparent bg-muted/60 shadow-none dark:bg-muted/60">
          <InputGroupAddon>
            <IconWorld />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Address"
            placeholder="about:blank"
            disabled={!live}
            value={typed ?? info?.url ?? ""}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={() => setTyped(undefined)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setTyped(undefined)
            }}
          />
        </InputGroup>
      </form>
      <div className="min-h-0 flex-1">
        <BrowserBody view={view} onRetry={browser.retry} />
      </div>
      <Playback label="Browser" live={live} />
    </div>
  )
}
