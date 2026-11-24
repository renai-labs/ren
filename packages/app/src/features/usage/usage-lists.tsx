import type { InsightsRow } from "@ren/client"
import { IconCpu, IconCube, IconKey, IconLock } from "@tabler/icons-react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { formatUsd } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { DefaultIcon } from "../../components/default-icon.js"
import { useShapeId } from "../../components/page.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { GoogleMark } from "../../icons/brands.js"
import { Logomark } from "../../icons/logomark.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMembers, type Member } from "../../lib/use-members.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { useNow } from "../../lib/use-now.js"
import { UsageQuery } from "./usage-query.js"
import type { UsageSearch } from "./usage-search.js"

const titles: Readonly<Record<UsageSearch.Breakdown, string>> = {
  space: "Spaces",
  member: "Members",
  agent: "Agents",
  model: "Models",
}

const shown = 5

const providerMarks: Readonly<Record<string, string>> = { anthropic: "Anthropic", openai: "OpenAI" }

const muted = "size-4 text-muted-foreground"

const nameOf = (by: UsageSearch.Breakdown, row: InsightsRow, member: Member | undefined) => {
  if (by === "space") return row.key === null ? "Inference keys" : (row.label ?? row.key)
  if (by === "member" && row.key !== null) return member?.name ?? row.label ?? "Former member"
  if (by === "model" && row.key !== null) return Insights.shortModel(row.key)
  return row.key ?? "Compute & other"
}

export function ModelIcon(props: { model: string }) {
  return <ProviderIcon provider={props.model.split("/")[0] ?? props.model} />
}

export function AgentIcon(props: { name: string }) {
  return props.name === "ren" ? (
    <Logomark className="size-4" />
  ) : (
    <DefaultIcon kind="skill" name={props.name} className="size-4 rounded-sm" />
  )
}

function ProviderIcon(props: { provider: string }) {
  if (props.provider === "google") return <GoogleMark className="size-4" />
  const mark = providerMarks[props.provider]
  if (mark) return <ProviderMark provider={mark} />
  return <IconCpu className={muted} />
}

function Glyph(props: { by: UsageSearch.Breakdown; row: InsightsRow; name: string; member: Member | undefined }) {
  const key = props.row.key
  if (props.by === "space") {
    if (key === null) return <IconKey className={muted} />
    if (props.row.label?.startsWith("Private space")) return <IconLock className={muted} />
    return <IconCube className={muted} />
  }
  if (key === null) return <IconCpu className={muted} />
  if (props.by === "member") return <PersonAvatar name={props.name} image={props.member?.image} />
  if (props.by === "agent") return <AgentIcon name={key} />
  return <ModelIcon model={key} />
}

const sample = (index: number): InsightsRow => ({
  key: `Loading item ${index + 1}`,
  label: "Loading item",
  sessions: 0,
  calls: 0,
  errors: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  cost: { ren: 0, customer: 0, unpricedCalls: 0, models: (shown - index) * 1_000_000, compute: 0, tools: 0 },
  computeMs: 0,
  tasksDone: null,
  prsMerged: null,
  prsLinked: null,
})

function Row(props: { by: UsageSearch.Breakdown; row: InsightsRow; fill: number }) {
  const members = useMembers()
  const member = members.member(props.row.key)
  const name = nameOf(props.by, props.row, member)
  return (
    <div className="relative flex min-h-9 items-center justify-between gap-4 px-3 py-1.5 text-sm">
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0 rounded-md bg-muted/70"
        // oxlint-disable-next-line react/forbid-dom-props -- the bar's length is this row's share of the largest cost
        style={{ width: `${Math.max(props.fill, 0.5)}%` }}
      />
      <span className="relative flex min-w-0 items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Glyph by={props.by} row={props.row} name={name} member={member} />
        </span>
        <span className="min-w-0 break-words">{name}</span>
      </span>
      <span className="relative shrink-0 tabular-nums">{formatUsd(Insights.dollars(Insights.cost(props.row)))}</span>
    </div>
  )
}

const listed = (by: UsageSearch.Breakdown, rows: ReadonlyArray<InsightsRow>, agents: ReadonlySet<string>) => {
  if (by === "agent") return rows.filter((row) => row.key !== null && agents.has(row.key))
  if (by === "member") return rows.filter((row) => row.key !== null)
  return rows
}

function Rows(props: { by: UsageSearch.Breakdown; rows: ReadonlyArray<InsightsRow>; title: string }) {
  const [open, setOpen] = useState(false)
  if (props.rows.length === 0)
    return <p className="px-3 pb-2 text-sm text-muted-foreground">No usage in this period.</p>
  const largest = Math.max(0, ...props.rows.map(Insights.cost))
  const hidden = props.rows.length - shown
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label={`Cost by ${props.title.toLowerCase()}`} className="flex flex-col gap-0.5">
        {(open ? props.rows : props.rows.slice(0, shown)).map((row, index) => (
          <li key={row.key ?? `none-${index}`}>
            <Row by={props.by} row={row} fill={largest > 0 ? (Insights.cost(row) / largest) * 100 : 0} />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? "Show fewer" : `Show ${hidden} more`}
        </Button>
      ) : null}
    </div>
  )
}

function UsageList(props: { scope: Insights.Scope; search: UsageSearch.Search; by: UsageSearch.Breakdown }) {
  const { api } = RouterContext.useRouterContext()
  const query = useQuery({
    ...api.insights.query.queryOptions(UsageQuery.breakdown(props.scope, props.search, props.by, useNow())),
    placeholderData: keepPreviousData,
  })
  const agents = useQuery({
    ...api.agent.list.queryOptions({
      page: 1,
      pageSize: pickerPageSize,
      isSubagent: false,
      ...(props.scope.spaceId && { spaceId: props.scope.spaceId }),
    }),
    enabled: props.by === "agent",
  })
  const names = new Set(agents.data?.items.map((agent) => agent.name))
  const shapeId = useShapeId(`usage-${props.by}`)
  const title = titles[props.by]
  const pending = query.isPending || (props.by === "agent" && agents.isPending)
  const rows =
    pending || !query.data
      ? Array.from({ length: shown }, (_, index) => sample(index))
      : listed(props.by, query.data.rows, names)
  return (
    <Card className={cn("gap-3 px-2 pt-5 pb-2 transition-opacity", query.isPlaceholderData && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-3 px-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-muted-foreground">Cost</span>
      </div>
      <Loading id={shapeId} loading={pending} label={`Loading ${title.toLowerCase()}`}>
        {query.isError ? (
          <div className="flex flex-col items-start gap-3 px-3 pb-2 text-sm text-muted-foreground">
            Couldn’t load {title.toLowerCase()}.
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <Rows by={props.by} rows={rows} title={title} />
        )}
      </Loading>
    </Card>
  )
}

export function UsageLists(props: { scope: Insights.Scope; search: UsageSearch.Search }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {UsageQuery.breakdowns(props.scope).map((by) => (
        <UsageList key={by} by={by} scope={props.scope} search={props.search} />
      ))}
    </div>
  )
}
