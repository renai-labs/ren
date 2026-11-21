import type { SessionInfo } from "@ren/client"
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
import { buttonVariants } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs, TabsContent } from "@ren/ui/tabs"
import { RelativeTime } from "@ren/util/relative-time"
import { localTimeZone } from "@ren/ui/time"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import { PageTabsList, PageTabsTrigger, TableCard, TableSample, useShapeId } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { Automations, type Automation } from "../../lib/automations.js"
import { useAutomationActions, useAutomations, useRuns } from "../../lib/use-automations.js"
import { useNow } from "../../lib/use-now.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { RunStatus } from "./run-status.js"

export type Tab = "automations" | "runs"

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
  const params = { spaceId: props.automation.spaceId, slug: props.automation.slug }
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

function AutomationRow(props: { automation: Automation; scoped: boolean; spaceName: string | undefined; now: number }) {
  const actions = useAutomationActions()
  const automation = props.automation
  const active = Automations.isActive(automation)
  const next = Automations.nextRunOf(automation)
  return (
    <TableRow className="relative cursor-pointer">
      <TableCell className="max-w-80">
        <span className="flex min-w-0 items-center gap-3">
          {automation.schedule ? (
            <IconClock className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconWebhook className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex min-w-0 flex-col">
            <EditorLink
              automation={automation}
              scoped={props.scoped}
              className="truncate outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
            >
              {automation.name}
            </EditorLink>
            {props.spaceName ? <span className="truncate text-xs text-muted-foreground">{props.spaceName}</span> : null}
          </span>
        </span>
      </TableCell>
      <TableCell className="max-w-64 truncate text-muted-foreground max-md:hidden">
        {Automations.triggerSummary(automation, localTimeZone())}
      </TableCell>
      <TableCell className="text-muted-foreground max-md:hidden">
        {next ? RelativeTime.format(next, props.now) : "—"}
      </TableCell>
      <TableCell>
        <Status automation={automation} />
      </TableCell>
      <TableCell>
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
              ...(automation.schedule
                ? [{ label: "Test now", icon: IconPlayerPlay, onSelect: () => actions.test(automation) }]
                : []),
              { label: "Duplicate", icon: IconCopy, onSelect: () => actions.duplicate(automation) },
              { label: "Copy as JSON", icon: IconCode, onSelect: () => actions.copyJson(automation) },
              {
                label: "Delete",
                icon: IconTrash,
                onSelect: () => actions.remove(automation),
                confirm: {
                  title: `Delete ${automation.name}?`,
                  description: "Its triggers stop and its webhook URL stops working. Chats it started stay.",
                  action: "Delete",
                },
              },
            ]}
          />
        </span>
      </TableCell>
    </TableRow>
  )
}

const columns = ["Automation", "Trigger", "Next run", "Status", ""]

const phoneHidden = new Set(["Trigger", "Next run", "Space"])

function AutomationTable(props: { spaceId: string | undefined }) {
  const list = useAutomations(props.spaceId)
  const spaces = useSpaces()
  const now = useNow()
  const shapeId = useShapeId("automations")
  const items = list.automations
  return (
    <Loading id={shapeId} loading={!items} label="Loading automations">
      {items ? null : <TableSample columns={columns} />}
      {items?.length === 0 ? (
        <EmptyState title="No automations yet" action={<NewAutomationButton spaceId={props.spaceId} />}>
          Run an agent on a schedule, or when another app sends a request.
        </EmptyState>
      ) : null}
      {items && items.length > 0 ? (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableHead
                    key={column}
                    className={cn(column === "" && "w-10", phoneHidden.has(column) && "max-md:hidden")}
                  >
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((automation) => (
                <AutomationRow
                  key={automation.key}
                  automation={automation}
                  scoped={props.spaceId !== undefined}
                  spaceName={props.spaceId ? undefined : spaces.spaceName(automation.spaceId)}
                  now={now}
                />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </Loading>
  )
}

function RunRow(props: { run: SessionInfo; scoped: boolean; spaceName: string; now: number }) {
  const run = props.run
  return (
    <TableRow className="relative cursor-pointer">
      <TableCell className="max-w-96 truncate">
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: run.id }}
          className="outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
        >
          {run.title || "Untitled run"}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground max-md:hidden">
        {run.origin === "webhook" ? "Webhook" : "Schedule"}
      </TableCell>
      {props.scoped ? null : <TableCell className="text-muted-foreground max-md:hidden">{props.spaceName}</TableCell>}
      <TableCell className="text-muted-foreground">{RelativeTime.format(run.createdAt, props.now)}</TableCell>
      <TableCell>
        <RunStatus tone={run.status === "busy" ? "working" : "done"}>
          {run.status === "busy" ? "Working" : "Done"}
        </RunStatus>
      </TableCell>
    </TableRow>
  )
}

const runColumns = (scoped: boolean) => ["Run", "Trigger", ...(scoped ? [] : ["Space"]), "Started", "Status"]

function RunsTable(props: { spaceId: string | undefined }) {
  const runs = useRuns({ spaceId: props.spaceId })
  const spaces = useSpaces()
  const now = useNow()
  const shapeId = useShapeId("automation-runs")
  const items = runs.data?.pages.flatMap((page) => page.items)
  const scoped = props.spaceId !== undefined
  return (
    <div className="flex flex-col gap-4">
      <Loading id={shapeId} loading={!items} label="Loading runs">
        {items ? null : <TableSample columns={runColumns(scoped)} />}
        {items?.length === 0 ? (
          <EmptyState title="No runs yet">Runs show here when a schedule fires or a webhook gets a request.</EmptyState>
        ) : null}
        {items && items.length > 0 ? (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {runColumns(scoped).map((column) => (
                    <TableHead key={column} className={cn(phoneHidden.has(column) && "max-md:hidden")}>
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((run) => (
                  <RunRow key={run.id} run={run} scoped={scoped} spaceName={spaces.spaceName(run.spaceId)} now={now} />
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ) : null}
      </Loading>
      <LoadMore more={runs.hasNextPage} loading={runs.isFetchingNextPage} onMore={() => void runs.fetchNextPage()} />
    </div>
  )
}

// oxlint-disable-next-line ren/no-comments -- The one Automations view, in the sidebar's Automations page and in a space.
export function AutomationsList(props: {
  spaceId: string | undefined
  tab: Tab
  onTab: (tab: Tab) => void
  actions?: React.ReactNode
}) {
  return (
    <Tabs value={props.tab} onValueChange={(tab) => props.onTab(tab === "runs" ? "runs" : "automations")}>
      <div className="flex items-center justify-between gap-4">
        <PageTabsList>
          <PageTabsTrigger value="automations">Automations</PageTabsTrigger>
          <PageTabsTrigger value="runs">Runs</PageTabsTrigger>
        </PageTabsList>
        {props.actions}
      </div>
      <TabsContent value="automations" className="flex flex-col gap-6 pt-6">
        <AutomationTable spaceId={props.spaceId} />
      </TabsContent>
      <TabsContent value="runs" className="pt-6">
        <RunsTable spaceId={props.spaceId} />
      </TabsContent>
    </Tabs>
  )
}
