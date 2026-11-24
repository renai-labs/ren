import type { ScheduleInfo, WebhookInfo } from "@ren/client"
import { useQuery, type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  IconClock,
  IconWebhook,
  IconCode,
  IconCopy,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { cn } from "cn"
import { Button, buttonVariants } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs, TabsContent } from "@ren/ui/tabs"
import { RelativeTime } from "@ren/util/relative-time"
import { localTimeZone } from "@ren/ui/time"
import { AppIcon } from "../../components/app-icon.js"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import {
  PageActions,
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  TableCard,
  TableSample,
  useShapeId,
} from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { SpaceLabel } from "../../components/space-label.js"
import { Automations, type Automation } from "../../lib/automations.js"
import { RouterContext } from "../../lib/router-context.js"
import { useAutomationActions, useScheduleList, useWebhookList } from "../../lib/use-automations.js"
import { useNow } from "../../lib/use-now.js"
import { Webhooks } from "../../lib/webhooks.js"

export function NewAutomationButton(props: { spaceId: string | undefined }) {
  const content = (
    <>
      <IconPlus data-icon="inline-start" />
      New automation
    </>
  )
  if (props.spaceId)
    return (
      <Link
        to="/spaces/$spaceId/automations/$slug"
        params={{ spaceId: props.spaceId, slug: Automations.newSlug }}
        className={buttonVariants()}
      >
        {content}
      </Link>
    )
  return (
    <Link to="/automations/new" className={buttonVariants()}>
      {content}
    </Link>
  )
}

function EditorLink(props: { automation: Automation; scoped: boolean; className?: string; children: React.ReactNode }) {
  const params = { spaceId: props.automation.spaceId, slug: props.automation.handle }
  return props.scoped ? (
    <Link to="/spaces/$spaceId/automations/$slug" params={params} className={props.className}>
      {props.children}
    </Link>
  ) : (
    <Link to="/automations/$spaceId/$slug" params={params} className={props.className}>
      {props.children}
    </Link>
  )
}

const dots = { attention: "bg-chart-3", active: "bg-chart-2", off: "bg-muted-foreground/40" } as const

function Status(props: { automation: Automation }) {
  const status = Automations.statusOf(props.automation)
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dots[status.tone])} />
      {status.label}
    </span>
  )
}

function AppLogo(props: { appId: string; name: string }) {
  const { api } = RouterContext.useRouterContext()
  const app = useQuery(api.app.get.queryOptions({ idOrSlug: props.appId }))
  return <AppIcon name={props.name} icon={app.data?.icon} size="sm" className="shrink-0" />
}

function KindIcon(props: { automation: Automation }) {
  const preset = props.automation.webhook?.preset
  if (preset) return <AppLogo appId={preset.appId} name={preset.appName} />
  const Icon = props.automation.schedule ? IconClock : IconWebhook
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

function RowActions(props: { automation: Automation }) {
  const actions = useAutomationActions()
  const automation = props.automation
  const active = Automations.isActive(automation)
  return (
    <span className="relative flex justify-end">
      <RowMenu
        label={`${automation.name} actions`}
        className="flex text-muted-foreground"
        items={[
          active
            ? {
                label: "Turn off",
                icon: IconPlayerPause,
                onSelect: () => actions.setActive(automation, { active: false }),
              }
            : {
                label: "Turn on",
                icon: IconPlayerPlay,
                onSelect: () => actions.setActive(automation, { active: true }),
              },
          { label: "Test now", icon: IconPlayerPlay, onSelect: () => actions.test(automation) },
          { label: "Duplicate", icon: IconCopy, onSelect: () => actions.duplicate(automation) },
          { label: "Copy as JSON", icon: IconCode, onSelect: () => actions.copyJson(automation) },
          {
            label: "Delete",
            icon: IconTrash,
            onSelect: () => actions.remove(automation),
            confirm: {
              title: `Delete ${automation.name}?`,
              description: "Its trigger stops and its webhook URL stops working. Chats it started stay.",
              action: "Delete",
            },
          },
        ]}
      />
    </span>
  )
}

function NameCell(props: { automation: Automation; scoped: boolean }) {
  return (
    <TableCell className="max-w-80 max-md:max-w-40">
      <span className="flex min-w-0 items-center gap-3">
        <KindIcon automation={props.automation} />
        <EditorLink
          automation={props.automation}
          scoped={props.scoped}
          className="truncate outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
        >
          {props.automation.name}
        </EditorLink>
      </span>
    </TableCell>
  )
}

function SpaceCell(props: { spaceId: string }) {
  return (
    <TableCell className="max-w-48 text-muted-foreground max-md:hidden">
      <SpaceLabel spaceId={props.spaceId} />
    </TableCell>
  )
}

const scheduleColumns = (scoped: boolean) => [
  "Name",
  ...(scoped ? [] : ["Space"]),
  "Frequency",
  "Next run",
  "Status",
  "",
]

const webhookColumns = (scoped: boolean) => ["Name", ...(scoped ? [] : ["Space"]), "Last request", "Status", ""]

const phoneHidden = new Set(["Space", "Frequency", "Last request", "Trigger"])

function Header(props: { columns: ReadonlyArray<string> }) {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {props.columns.map((column) => (
          <TableHead key={column} className={cn(column === "" && "w-10", phoneHidden.has(column) && "max-md:hidden")}>
            {column}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  )
}

function ScheduleRow(props: { schedule: ScheduleInfo; scoped: boolean; now: number }) {
  const automation = Automations.ofSchedule(props.schedule)
  const next = Automations.nextRunOf(automation)
  return (
    <TableRow className="relative cursor-pointer">
      <NameCell automation={automation} scoped={props.scoped} />
      {props.scoped ? null : <SpaceCell spaceId={automation.spaceId} />}
      <TableCell className="max-w-56 truncate text-muted-foreground max-md:hidden">
        {Automations.triggerSummary(automation, localTimeZone())}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {next ? RelativeTime.format(next, props.now) : "—"}
      </TableCell>
      <TableCell>
        <Status automation={automation} />
      </TableCell>
      <TableCell>
        <RowActions automation={automation} />
      </TableCell>
    </TableRow>
  )
}

function WebhookRow(props: { webhook: WebhookInfo; scoped: boolean; now: number }) {
  const automation = Automations.ofWebhook(props.webhook)
  const last = props.webhook.lastRequest
  return (
    <TableRow className="relative cursor-pointer">
      <NameCell automation={automation} scoped={props.scoped} />
      {props.scoped ? null : <SpaceCell spaceId={automation.spaceId} />}
      <TableCell className="text-muted-foreground max-md:hidden">
        {last ? `${Webhooks.outcomes[last.outcome].label} ${RelativeTime.format(last.receivedAt, props.now)}` : "—"}
      </TableCell>
      <TableCell>
        <Status automation={automation} />
      </TableCell>
      <TableCell>
        <RowActions automation={automation} />
      </TableCell>
    </TableRow>
  )
}

function KindTable<A>(props: {
  name: string
  columns: ReadonlyArray<string>
  list: Pick<
    UseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<A> }>>,
    "data" | "isError" | "hasNextPage" | "isFetchingNextPage" | "fetchNextPage" | "refetch"
  >
  empty: React.ReactNode
  row: (item: A) => React.ReactNode
}) {
  const shapeId = useShapeId(props.name)
  const items = props.list.data?.pages.flatMap((page) => page.items)
  if (props.list.isError && !items)
    return (
      <EmptyState
        title="Couldn’t load automations"
        action={
          <Button variant="outline" onClick={() => void props.list.refetch()}>
            Try again
          </Button>
        }
      >
        Check your connection and try again.
      </EmptyState>
    )
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Loading id={shapeId} loading={!items} label={`Loading ${props.name}`} className="flex min-h-0 flex-col">
        {items ? null : <TableSample columns={[...props.columns]} />}
        {items?.length === 0 ? props.empty : null}
        {items && items.length > 0 ? (
          <TableCard scroll>
            <Table>
              <Header columns={props.columns} />
              <TableBody>{items.map(props.row)}</TableBody>
            </Table>
          </TableCard>
        ) : null}
      </Loading>
      <LoadMore
        more={props.list.hasNextPage}
        loading={props.list.isFetchingNextPage}
        onMore={() => void props.list.fetchNextPage()}
      />
    </div>
  )
}

function AutomationTables(props: {
  spaceId: string | undefined
  kind: Automations.ListKind
  schedules: ReturnType<typeof useScheduleList>
  webhooks: ReturnType<typeof useWebhookList>
}) {
  const now = useNow()
  const scoped = props.spaceId !== undefined
  const empty = (title: string, body: string) => (
    <EmptyState title={title} action={<NewAutomationButton spaceId={props.spaceId} />}>
      {body}
    </EmptyState>
  )
  if (props.kind === "webhooks")
    return (
      <KindTable
        name="webhooks"
        columns={webhookColumns(scoped)}
        list={props.webhooks}
        empty={empty("No webhooks yet", "Run an agent when another app sends a request.")}
        row={(webhook: WebhookInfo) => <WebhookRow key={webhook.id} webhook={webhook} scoped={scoped} now={now} />}
      />
    )
  return (
    <KindTable
      name="schedules"
      columns={scheduleColumns(scoped)}
      list={props.schedules}
      empty={empty("No schedules yet", "Run an agent at set times.")}
      row={(schedule: ScheduleInfo) => <ScheduleRow key={schedule.id} schedule={schedule} scoped={scoped} now={now} />}
    />
  )
}

// oxlint-disable-next-line ren/no-comments -- The one Automations view, in the sidebar's Automations page and in a space: a tab for schedules and a tab for webhooks.
export function AutomationsList(props: {
  spaceId: string | undefined
  kind: Automations.ListKind
  onKind: (kind: Automations.ListKind) => void
  actions?: React.ReactNode
}) {
  const schedules = useScheduleList(props.spaceId)
  const webhooks = useWebhookList(props.spaceId)
  return (
    <Tabs
      value={props.kind}
      onValueChange={(value: unknown) => {
        const kind = Automations.kinds.find((choice) => choice.value === value)
        if (kind) props.onKind(kind.value)
      }}
      className="min-h-0"
    >
      <PageTabs>
        <PageTabsList>
          <PageTabsTrigger value="schedules" count={schedules.data?.pages.at(0)?.total}>
            Schedules
          </PageTabsTrigger>
          <PageTabsTrigger value="webhooks" count={webhooks.data?.pages.at(0)?.total}>
            Webhooks
          </PageTabsTrigger>
        </PageTabsList>
      </PageTabs>
      <PageActions>{props.actions}</PageActions>
      <TabsContent value={props.kind} className="flex min-h-0 flex-col">
        <AutomationTables spaceId={props.spaceId} kind={props.kind} schedules={schedules} webhooks={webhooks} />
      </TabsContent>
    </Tabs>
  )
}
