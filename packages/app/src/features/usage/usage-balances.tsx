import type { BillingSummary, RenInferenceConnection } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Card } from "@ren/ui/card"
import { Loading } from "@ren/ui/loading"
import { CreditsCard } from "../../components/credits-card.js"
import { useShapeId } from "../../components/page.js"
import { ProviderMark } from "../../components/provider-mark.js"
import { StatusBadge } from "../../components/status-badge.js"
import { SubscriptionLimits } from "../../components/subscription-limits.js"
import { RouterContext } from "../../lib/router-context.js"

const link = "block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 *:h-full"

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
  limits: [{ key: "sample", title: "Current session", percent: 0 }],
}

function SubscriptionSummary(props: { connection: RenInferenceConnection }) {
  const connection = props.connection
  return (
    <Link to="/settings/providers" className={link}>
      <Card className="gap-3 border px-4 ring-0">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <ProviderMark provider={connection.providerName} />
            <span className="truncate">{connection.label}</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tone={connection.status.tone}>{connection.status.label}</StatusBadge>
            {connection.plan ? <span>· {connection.plan}</span> : null}
          </span>
        </div>
        {connection.limits.length === 0 ? (
          <p className="text-xs text-muted-foreground">Usage appears after the first request.</p>
        ) : (
          <SubscriptionLimits limits={connection.limits} />
        )}
      </Card>
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
      <section aria-label="Credits and subscriptions" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary ? (
          <Link to="/settings/billing" className={link}>
            <CreditsCard billing={summary} />
          </Link>
        ) : null}
        {subscriptions.map((connection) => (
          <SubscriptionSummary key={connection.id} connection={connection} />
        ))}
      </section>
    </Loading>
  )
}
