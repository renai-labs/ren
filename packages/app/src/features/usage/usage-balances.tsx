import type { BillingSummary, RenInferenceConnection } from "@ren/client"
import { IconChevronRight } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { formatUsd } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { useShapeId } from "../../components/page.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { StatusBadge } from "../../components/status-badge.js"
import { Insights } from "../../lib/insights.js"
import { RouterContext } from "../../lib/router-context.js"

const sampleBilling: BillingSummary = {
  plan: "free",
  planStatus: null,
  renewsAt: null,
  pendingPlan: null,
  availableMicroUsd: 1_000_000,
  grantedMicroUsd: 1_000_000,
}

const sampleConnection: RenInferenceConnection = {
  id: "sample",
  label: "Team subscription",
  providerName: "Anthropic",
  iconUrl: "",
  status: { tone: "ok", label: "Connected" },
  canManage: false,
  canReconnect: false,
  meters: [{ key: "sample", title: "Current session", percent: 0 }],
}

const item =
  "inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"

const money = (micro: number) => formatUsd(Insights.dollars(Math.max(micro, 0)))

function Chevron() {
  return <IconChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
}

function Credits(props: { billing: BillingSummary }) {
  const granted = props.billing.grantedMicroUsd > 0
  const depleted = granted && props.billing.availableMicroUsd <= 0
  return (
    <Link to="/settings/billing" className={item}>
      <span className="text-muted-foreground">Credits</span>
      <span className={cn("font-medium tabular-nums", depleted && "text-destructive")}>
        {money(props.billing.availableMicroUsd)}
      </span>
      {depleted ? <span className="text-destructive">Used up</span> : null}
      {granted && !depleted ? (
        <span className="text-muted-foreground tabular-nums">of {money(props.billing.grantedMicroUsd)}</span>
      ) : null}
      <Chevron />
    </Link>
  )
}

function Subscription(props: { connection: RenInferenceConnection }) {
  const connection = props.connection
  const meter = connection.meters.find((each) => each.percent !== null)
  const detail = () => {
    if (connection.status.tone !== "ok")
      return <StatusBadge tone={connection.status.tone}>{connection.status.label}</StatusBadge>
    if (meter)
      return (
        <span className="text-muted-foreground tabular-nums">
          {meter.title} {meter.percent}%
        </span>
      )
    return null
  }
  return (
    <Link to="/settings/providers" className={item}>
      <ProviderMark provider={connection.providerName} />
      <span>{connection.label}</span>
      {detail()}
      <Chevron />
    </Link>
  )
}

export function UsageBalances() {
  const { api } = RouterContext.useRouterContext()
  const billing = useQuery({ ...api.billing.get.queryOptions(), retry: false })
  const connections = useQuery({ ...api["ren-inference"].connection.list.queryOptions(), retry: false })
  const shapeId = useShapeId("usage-balances")
  const pending = billing.isPending || connections.isPending
  const summary = pending ? sampleBilling : billing.data
  const subscriptions = pending ? [sampleConnection] : (connections.data ?? [])
  if (!summary && subscriptions.length === 0) return null
  return (
    <Loading id={shapeId} loading={pending} label="Loading credits and subscriptions">
      <ul aria-label="Credits and subscriptions" className="flex items-center gap-1">
        {summary ? (
          <li>
            <Credits billing={summary} />
          </li>
        ) : null}
        {subscriptions.map((connection) => (
          <li key={connection.id}>
            <Subscription connection={connection} />
          </li>
        ))}
      </ul>
    </Loading>
  )
}
