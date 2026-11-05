import type { ReactNode } from "react"
import {
  IconArrowLeft,
  IconArrowRight,
  IconDeviceDesktop,
  IconHandFinger,
  IconRefresh,
  IconWorld,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Progress } from "@ren/ui/progress"

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
        <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground/60" />
          Offline
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

export function BrowserTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
        <Button variant="ghost" size="icon" aria-label="Back" disabled className="text-muted-foreground">
          <IconArrowLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward" disabled className="text-muted-foreground">
          <IconArrowRight />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Reload" disabled className="text-muted-foreground">
          <IconRefresh />
        </Button>
        <InputGroup className="flex-1 border-transparent bg-muted/60 shadow-none dark:bg-muted/60">
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
