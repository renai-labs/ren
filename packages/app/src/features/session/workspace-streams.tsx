import { type ReactNode, useRef, useState } from "react"
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
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Browser } from "../../lib/browser.js"
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

export function ComputerTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Waiting
        icon={<IconDeviceDesktop />}
        title="Computer"
        description="The environment’s desktop streams here once it’s connected."
      />
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

function LiveView(props: { info: Browser.Info; root: Session.ID; running: boolean; onRetry: () => void }) {
  const stop = ChatReact.useAction(props.root, (opened) => opened.stop(props.root))
  const src = new URL(props.info.liveView)
  src.searchParams.set("readOnly", "true")
  const frame = useRef<HTMLIFrameElement>(null)
  const view = useLiveView(frame, src.href, { running: props.running, stop })
  if (view.status === "failed") return <Failed onRetry={props.onRetry} />
  return (
    <div className="relative size-full">
      <iframe
        ref={frame}
        src={src.href}
        title={props.info.title || "Browser"}
        // oxlint-disable-next-line react/iframe-missing-sandbox -- The live view is on Kernel's origin, so it cannot reach this page; its client needs its own storage.
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="origin"
        allow="autoplay; clipboard-read; clipboard-write"
        className="size-full border-0 bg-muted"
      />
      {view.status === "playing" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <Button
            variant="outline"
            disabled={view.pending}
            aria-pressed={view.controlled}
            className="pointer-events-auto rounded-full bg-background shadow-md"
            onClick={() =>
              view.toggle((error) =>
                toast.error("Couldn’t change who controls the browser", { description: errorMessage(error) }),
              )
            }
          >
            {view.pending ? <Spinner data-icon="inline-start" /> : <IconHandFinger data-icon="inline-start" />}
            {view.controlled ? "Give control back" : "Take control"}
          </Button>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <Spinner className="text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

const addressOf = (typed: string) =>
  /^[a-z][a-z\d+.-]*:\/\//i.test(typed) || typed.startsWith("about:") ? typed : `https://${typed}`

function BrowserBody(props: {
  root: Session.ID
  info: Browser.Info | null | undefined
  failed: boolean
  running: boolean
}) {
  const [attempt, setAttempt] = useState(0)
  const info = props.info
  if (!info)
    return (
      <Waiting
        icon={<IconWorld />}
        title="Browser"
        description="The pages Ren opens in its cloud browser stream here."
      />
    )
  if (info.closed)
    return (
      <Waiting icon={<IconWorld />} title="Browser closed" description="Ren closed the browser, or it timed out." />
    )
  const retry = () => setAttempt(attempt + 1)
  if (props.failed) return <Failed onRetry={retry} />
  return (
    <LiveView key={`${info.id}:${attempt}`} info={info} root={props.root} running={props.running} onRetry={retry} />
  )
}

export function BrowserTab(props: { root: Session.ID; ids: ReadonlyArray<string>; running: boolean }) {
  const browser = Browser.useWatch(props.root, props.ids)
  const info = browser.info
  const live = Boolean(info && !info.closed && !browser.failed)
  const [typed, setTyped] = useState<string>()
  const go = (to: Browser.Navigate) =>
    void browser
      .navigate(to)
      .catch((error: unknown) => toast.error("Couldn’t open the page", { description: errorMessage(error) }))
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
        <BrowserBody root={props.root} info={info} failed={browser.failed} running={props.running} />
      </div>
    </div>
  )
}
