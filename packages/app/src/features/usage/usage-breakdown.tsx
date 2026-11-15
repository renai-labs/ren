import type { InsightsQueryInput, InsightsRow } from "@ren/client"
import { IconCpu, IconCube, IconKey, IconLock } from "@tabler/icons-react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Button, buttonVariants } from "@ren/ui/button"
import { formatCount, formatTokens, formatUsd } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"
import { DefaultIcon } from "../../components/default-icon.js"
import { EmptyState } from "../../components/empty-state.js"
import {
  PageTabsList,
  PageTabsTrigger,
  Section,
  TableCard,
  TableEmpty,
  TableSample,
  useShapeId,
} from "../../components/page.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { GoogleMark } from "../../icons/brands.js"
import { Logomark } from "../../icons/logomark.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMembers, type Member } from "../../lib/use-members.js"
import { UsageQuery } from "./usage-query.js"
import { UsageSearch } from "./usage-search.js"

const tabLabels: Readonly<Record<UsageSearch.Breakdown, string>> = {
  space: "Spaces",
  member: "Members",
  agent: "Agents",
  model: "Models",
  provider: "Providers",
}

const nameHeads: Readonly<Record<UsageSearch.Breakdown, string>> = {
  space: "Space",
  member: "Member",
  agent: "Agent",
  model: "Model",
  provider: "Provider",
}

const providerMarks: Readonly<Record<string, string>> = { anthropic: "Anthropic", openai: "OpenAI" }

const overlay =
  "after:absolute after:inset-0 focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"

const nameOf = (by: UsageSearch.Breakdown, row: InsightsRow, member: Member | undefined) => {
  if (by === "space") return row.key === null ? "Inference keys" : (row.label ?? row.key)
  if (by === "member" && row.key !== null) return member?.name ?? row.label ?? "Former member"
  return row.key ?? "Compute & other"
}

function ProviderIcon(props: { provider: string }) {
  if (props.provider === "google") return <GoogleMark className="size-4 shrink-0" />
  const mark = providerMarks[props.provider]
  if (mark) return <ProviderMark provider={mark} />
  return <IconCpu className="size-4 shrink-0 text-muted-foreground" />
}

function RowIcon(props: { by: UsageSearch.Breakdown; row: InsightsRow; name: string; member: Member | undefined }) {
  const key = props.row.key
  if (props.by === "space") {
    if (key === null) return <IconKey className="size-4 shrink-0 text-muted-foreground" />
    if (props.row.label?.startsWith("Private space"))
      return <IconLock className="size-4 shrink-0 text-muted-foreground" />
    return <IconCube className="size-4 shrink-0 text-muted-foreground" />
  }
  if (key === null) return <IconCpu className="size-4 shrink-0 text-muted-foreground" />
  if (props.by === "member") return <PersonAvatar name={props.name} image={props.member?.image} />
  if (props.by === "agent")
    return key === "ren" ? (
      <Logomark className="size-4 shrink-0" />
    ) : (
      <DefaultIcon kind="skill" name={key} className="size-5 rounded-md" />
    )
  return <ProviderIcon provider={key.split("/")[0] ?? key} />
}

function ShareRing(props: { share: number }) {
  const circumference = 2 * Math.PI * 6
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0 -rotate-90">
      <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-secondary" />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        strokeWidth="2.5"
        strokeDasharray={`${(props.share / 100) * circumference} ${circumference}`}
        className="stroke-chart-1"
      />
    </svg>
  )
}

function RowName(props: {
  row: InsightsRow
  by: UsageSearch.Breakdown
  member: Member | undefined
  period: UsageSearch.Search["period"]
  onFilter: (key: string) => void
}) {
  const key = props.row.key
  const name = nameOf(props.by, props.row, props.member)
  const label = (
    <span className="flex min-w-0 items-center gap-2.5">
      <RowIcon by={props.by} row={props.row} name={name} member={props.member} />
      <span className="truncate">{name}</span>
    </span>
  )
  if (key === null || props.by === "provider") return <span title={name}>{label}</span>
  if (props.by === "space")
    return (
      <Link
        to="/spaces/$spaceId/usage"
        params={{ spaceId: key }}
        search={{ period: props.period }}
        title={name}
        className={buttonVariants({
          variant: "link",
          className: cn(
            "h-auto max-w-full min-w-0 justify-start p-0 font-normal text-foreground hover:no-underline",
            overlay,
          ),
        })}
      >
        {label}
      </Link>
    )
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="link"
            onClick={() => props.onFilter(key)}
            className={cn(
              "h-auto max-w-full min-w-0 justify-start p-0 font-normal text-foreground hover:no-underline active:not-aria-[haspopup]:scale-none",
              overlay,
            )}
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent side="bottom">Show only {name}</TooltipContent>
    </Tooltip>
  )
}

function BreakdownRow(props: {
  row: InsightsRow
  by: UsageSearch.Breakdown
  member: Member | undefined
  share: number
  tasks: boolean
  period: UsageSearch.Search["period"]
  onFilter: (key: string) => void
}) {
  const row = props.row
  const cost = Insights.cost(row)
  const tokens = Insights.tokens(row)
  return (
    <TableRow className={cn("relative", row.key !== null && props.by !== "provider" && "cursor-pointer")}>
      <TableCell>
        <RowName row={row} by={props.by} member={props.member} period={props.period} onFilter={props.onFilter} />
      </TableCell>
      <TableCell>
        <span className="flex items-center justify-end gap-2 tabular-nums">
          <ShareRing share={props.share} />
          <span className="w-9 text-xs text-muted-foreground">{Math.round(props.share)}%</span>
          <span className={cn("w-20 text-right", cost === 0 && "text-muted-foreground")}>
            {formatUsd(Insights.dollars(cost))}
          </span>
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(row.sessions)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(row.calls)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {tokens === 0 ? <span className="text-muted-foreground">—</span> : formatTokens(tokens)}
      </TableCell>
      {props.tasks ? (
        <TableCell className="text-right tabular-nums">
          {row.tasksDone ? formatCount(row.tasksDone) : <span className="text-muted-foreground">—</span>}
        </TableCell>
      ) : null}
    </TableRow>
  )
}

function BreakdownTable(props: {
  by: UsageSearch.Breakdown
  input: InsightsQueryInput
  period: UsageSearch.Search["period"]
  onSearchChange: UsageSearch.Change
}) {
  const { api } = RouterContext.useRouterContext()
  const members = useMembers()
  const query = useQuery({ ...api.insights.query.queryOptions(props.input), placeholderData: keepPreviousData })
  const shapeId = useShapeId(`usage-${props.by}`)
  const tasks = props.by !== "model" && props.by !== "provider"
  const total = (query.data?.rows ?? []).reduce((sum, row) => sum + Insights.cost(row), 0)
  const columns = [
    { label: nameHeads[props.by], className: "" },
    { label: "Cost", className: "w-44 text-right" },
    { label: "Chats", className: "w-20 text-right" },
    { label: "Calls", className: "w-20 text-right" },
    { label: "Tokens", className: "w-20 text-right" },
    ...(tasks ? [{ label: "Tasks done", className: "w-24 text-right" }] : []),
  ]
  if (query.isError) return <EmptyState>Couldn’t load usage.</EmptyState>
  return (
    <Loading id={shapeId} loading={query.isPending} label="Loading usage breakdown">
      {query.data ? (
        <TableCard className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.label} className={column.className}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.length === 0 ? (
                <TableEmpty columns={columns.length}>No usage in this period.</TableEmpty>
              ) : null}
              {query.data.rows.map((row) => (
                <BreakdownRow
                  key={row.key ?? "none"}
                  row={row}
                  by={props.by}
                  member={members.member(row.key)}
                  share={total > 0 ? (Insights.cost(row) / total) * 100 : 0}
                  tasks={tasks}
                  period={props.period}
                  onFilter={(key) => {
                    if (props.by === "member") props.onSearchChange({ member: key })
                    if (props.by === "agent") props.onSearchChange({ agent: key })
                    if (props.by === "model") props.onSearchChange({ model: key })
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : (
        <TableSample columns={columns.map((column) => column.label)} count={4} />
      )}
    </Loading>
  )
}

export function UsageBreakdown(props: {
  scope: Insights.Scope
  search: UsageSearch.Search
  input: InsightsQueryInput
  onSearchChange: UsageSearch.Change
}) {
  const by = UsageQuery.breakdownOf(props.scope, props.search)
  return (
    <Section title="Breakdown">
      <Tabs
        value={by}
        onValueChange={(value: string) => {
          const next = UsageQuery.breakdowns(props.scope).find((each) => each === value)
          if (next) props.onSearchChange({ by: next })
        }}
      >
        <PageTabsList aria-label="Break usage down by">
          {UsageQuery.breakdowns(props.scope).map((each) => (
            <PageTabsTrigger key={each} value={each}>
              {tabLabels[each]}
            </PageTabsTrigger>
          ))}
        </PageTabsList>
      </Tabs>
      <BreakdownTable
        key={by}
        by={by}
        input={props.input}
        period={props.search.period}
        onSearchChange={props.onSearchChange}
      />
    </Section>
  )
}
