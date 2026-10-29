import type { ReactNode } from "react"
import {
  IconArrowLeft,
  IconArrowRight,
  IconDeviceDesktop,
  IconHandFinger,
  IconRefresh,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"

function Waiting(props: { icon: ReactNode; title: string; description: string }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">{props.icon}</EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function Playback(props: { label: string }) {
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
        <Badge variant="secondary" className="gap-1.5 font-normal text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground/60" />
          Offline
        </Badge>
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
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div className="aspect-video w-full max-w-full overflow-hidden rounded-lg border bg-muted/40">
          <Waiting
            icon={<IconDeviceDesktop />}
            title="Computer"
            description="The environment’s desktop streams here once it’s connected."
          />
        </div>
      </div>
      <Playback label="Computer" />
    </div>
  )
}

export function BrowserTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
        <Button variant="ghost" size="icon" aria-label="Back" disabled className="text-muted-foreground">
          <IconArrowLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward" disabled className="text-muted-foreground">
          <IconArrowRight />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Reload" disabled className="text-muted-foreground">
          <IconRefresh />
        </Button>
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <IconWorld />
          </InputGroupAddon>
          <InputGroupInput aria-label="Address" placeholder="about:blank" readOnly disabled />
        </InputGroup>
      </div>
      <div className="min-h-0 flex-1">
        <Waiting
          icon={<IconWorld />}
          title="Browser"
          description="The pages Ren opens in the environment’s browser stream here."
        />
      </div>
      <Playback label="Browser" />
    </div>
  )
}

export function TerminalTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-sidebar font-mono text-xs">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-muted-foreground">
          <IconTerminal2 className="size-3.5" />
          /bin/bash
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-3 leading-5">
          <span className="text-muted-foreground"># The environment’s terminal streams here once it’s connected.</span>
          <span>
            <span className="text-chart-2">ren@environment</span>
            <span className="text-muted-foreground">:</span>
            <span className="text-chart-1">~</span>
            <span className="text-muted-foreground">$</span>
          </span>
        </div>
      </div>
    </div>
  )
}
