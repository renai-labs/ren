import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconDownload,
  IconLink,
  IconListCheck,
  IconMessage,
  IconPlus,
  IconPuzzle,
  IconStar,
  IconTerminal2,
  IconUserPlus,
  type Icon,
} from "@tabler/icons-react"
import { buttonVariants } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Progress } from "@ren/ui/progress"
import { cn } from "cn"
import { AppIcon } from "../../components/app-icon.js"
import { ChannelMark } from "../../components/channel-mark.js"
import { EmptyState } from "../../components/empty-state.js"
import { Page } from "../../components/page.js"
import { AppRegistryLists } from "../../lib/app-registry.js"
import { Onboarding } from "../../lib/onboarding.js"
import { RouterContext } from "../../lib/router-context.js"
import { useCanAdminister } from "../../lib/use-organization.js"
import { StepAction } from "./step-action.js"

const row =
  "flex-nowrap gap-3 rounded-none text-left focus-visible:ring-inset enabled:hover:bg-muted/50 disabled:cursor-progress [a]:hover:bg-muted/50"

const taskRow = cn(row, "min-h-16 items-start px-4 py-3")

const partRow = cn(row, "min-h-10 py-2 pr-4 pl-11")

const glyphs = { import: IconDownload, plugin: IconPuzzle } as const

const actionIcons = {
  external: IconStar,
  app: IconLink,
  channel: IconLink,
  provider: IconLink,
  "custom-app": IconPlus,
  "import-memory": IconDownload,
  invite: IconUserPlus,
  chat: IconMessage,
  page: IconPlus,
  guide: IconTerminal2,
} as const satisfies Record<Onboarding.Action["kind"], Icon>

export function OnboardingPage() {
  const { api } = RouterContext.useRouterContext()
  const admin = useCanAdminister()
  const onboarding = useQuery(api.onboarding.get.queryOptions())
  const lists = Onboarding.checklists(onboarding.data ?? Onboarding.empty, { admin })
  return (
    <Page
      title="Onboarding"
      description="Finish each step to earn Ren credits."
      aside={onboarding.isError ? undefined : <Credits progress={lists.progress} />}
      loading={onboarding.isPending}
    >
      {onboarding.isError ? (
        <EmptyState title="Couldn’t load onboarding">Reload the page to try again.</EmptyState>
      ) : (
        <Checklist tasks={[...lists.personal, ...(lists.organization ?? [])]} />
      )}
    </Page>
  )
}

function Credits(props: { progress: Onboarding.Progress }) {
  const progress = props.progress
  return (
    <div className="grid gap-2 pt-1.5">
      <p className="text-sm whitespace-nowrap tabular-nums">
        <span className="font-medium">{Onboarding.usd(progress.earned)}</span>
        <span className="text-muted-foreground"> of {Onboarding.usd(progress.available)} in credits</span>
      </p>
      <Progress
        value={progress.available > 0 ? (progress.earned / progress.available) * 100 : 0}
        aria-label="Credits earned"
        className="w-full **:data-[slot=progress-indicator]:bg-chart-1 **:data-[slot=progress-track]:bg-muted"
      />
    </div>
  )
}

function Steps(props: { tasks: ReadonlyArray<Onboarding.TaskState> }) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {props.tasks.map((state) => (
        <li key={state.task.id}>{state.parts.length > 0 ? <GroupRow state={state} /> : <TaskRow state={state} />}</li>
      ))}
    </ul>
  )
}

function Checklist(props: { tasks: ReadonlyArray<Onboarding.TaskState> }) {
  const open = props.tasks.filter((state) => !state.done)
  const done = props.tasks.filter((state) => state.done)
  return (
    <div className="flex flex-col gap-6">
      {open.length > 0 ? <Steps tasks={open} /> : null}
      {done.length > 0 ? (
        <Collapsible defaultOpen={open.length === 0}>
          <CollapsibleTrigger className="group/done -ml-1 flex items-center gap-1.5 rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Completed
            <span className="font-normal tabular-nums">{done.length}</span>
            <IconChevronDown
              aria-hidden
              className="size-4 transition-transform duration-200 ease-out group-data-panel-open/done:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
            <div className="pt-3">
              <Steps tasks={done} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

function StepMark(props: { done: boolean }) {
  return (
    <ItemMedia variant="icon">
      {props.done ? (
        <IconCircleCheck aria-hidden className="text-chart-2" />
      ) : (
        <IconCircleDashed aria-hidden className="text-muted-foreground" />
      )}
      <span className="sr-only">{props.done ? "Done:" : "To do:"}</span>
    </ItemMedia>
  )
}

function Reward(props: { state: Onboarding.TaskState }) {
  const state = props.state
  const reward = state.task.reward
  if (!reward) return null
  return (
    <span className={cn("font-normal tabular-nums", state.done ? "text-chart-2" : "text-muted-foreground")}>
      <span aria-hidden className="mr-2 text-muted-foreground/60">
        ·
      </span>
      <span className="sr-only">{state.done ? "Earned " : "Earn "}</span>
      {reward.upTo && !state.done ? "Up to " : "+"}
      {Onboarding.usd(state.done ? state.earned : state.available)}
    </span>
  )
}

function TaskText(props: { state: Onboarding.TaskState; count?: string | undefined }) {
  return (
    <ItemContent className="min-w-0 gap-0.5">
      <ItemTitle className="leading-5">
        {props.state.task.title}
        {props.count ? <span className="font-normal text-muted-foreground tabular-nums">{props.count}</span> : null}
        <Reward state={props.state} />
      </ItemTitle>
      <ItemDescription className="text-xs text-pretty">{props.state.task.description}</ItemDescription>
    </ItemContent>
  )
}

function ActionHint(props: { icon: Icon; children: ReactNode }) {
  return (
    <span
      className={buttonVariants({
        variant: "secondary",
        size: "sm",
        className:
          "pointer-events-none -my-0.75 shrink-0 transition-opacity duration-150 ease-out pointer-fine:opacity-0 pointer-fine:group-hover/item:opacity-100 pointer-fine:group-focus-visible/item:opacity-100 motion-reduce:transition-none",
      })}
    >
      <props.icon data-icon="inline-start" />
      {props.children}
    </span>
  )
}

function TaskRow(props: { state: Onboarding.TaskState }) {
  const state = props.state
  const action = state.task.action
  const content = (
    <>
      <StepMark done={state.done} />
      <TaskText state={state} />
    </>
  )
  if (action && (!state.done || state.task.reward?.upTo !== undefined))
    return (
      <StepAction action={action} className={taskRow}>
        {content}
        <ActionHint icon={actionIcons[action.kind]}>{action.label}</ActionHint>
      </StepAction>
    )
  return (
    <Item className={taskRow}>
      {content}
      <ItemMedia variant="icon" className="size-4" />
    </Item>
  )
}

function GroupRow(props: { state: Onboarding.TaskState }) {
  const state = props.state
  const count =
    state.partsNeeded > 1 && state.partsNeeded < state.parts.length
      ? `${Math.min(state.partsDone, state.partsNeeded)} of ${state.partsNeeded}`
      : undefined
  return (
    <Collapsible defaultOpen={!state.done}>
      <Item render={<CollapsibleTrigger />} className={taskRow}>
        <StepMark done={state.done} />
        <TaskText state={state} count={count} />
        <ActionHint icon={IconListCheck}>
          <span className="group-data-panel-open/item:hidden">Show steps</span>
          <span className="hidden group-data-panel-open/item:inline">Hide steps</span>
        </ActionHint>
        <ItemMedia variant="icon" className="text-muted-foreground">
          <IconChevronDown
            aria-hidden
            className="transition-transform duration-200 ease-out group-data-panel-open/item:rotate-180 motion-reduce:transition-none"
          />
        </ItemMedia>
      </Item>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <ul aria-label={`Steps for ${state.task.title}`} className="pb-2">
          {state.parts.map((part) => (
            <li key={part.part.step}>
              <PartRow part={part.part} done={part.done} />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function PartMark(props: { part: Onboarding.Part }) {
  const { api } = RouterContext.useRouterContext()
  const registry = useQuery(AppRegistryLists.bySlugs(api, Onboarding.appSlugs))
  const mark = props.part.mark
  if ("app" in mark) {
    const app = registry.data?.items.find((each) => each.slug === mark.app)
    return <AppIcon name={app?.name ?? props.part.title} description={app?.description} icon={app?.icon} size="sm" />
  }
  if ("channel" in mark) return <ChannelMark provider={mark.channel} className="size-5 shrink-0" />
  const Glyph = glyphs[mark.glyph]
  return <Glyph aria-hidden className="size-5 shrink-0 text-muted-foreground" />
}

function PartRow(props: { part: Onboarding.Part; done: boolean }) {
  const part = props.part
  const content = (
    <>
      <ItemMedia>
        <PartMark part={part} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className={cn("font-normal", props.done && "text-muted-foreground")}>{part.title}</ItemTitle>
      </ItemContent>
      {props.done ? (
        <span className="flex items-center gap-1 text-xs text-chart-2">
          <IconCheck aria-hidden className="size-3.5" />
          Done
        </span>
      ) : (
        <ActionHint icon={actionIcons[part.action.kind]}>{part.action.label}</ActionHint>
      )}
    </>
  )
  if (props.done)
    return (
      <Item className={partRow}>
        {content}
        <ItemMedia variant="icon" className="size-4" />
      </Item>
    )
  return (
    <StepAction action={part.action} className={partRow}>
      {content}
    </StepAction>
  )
}
