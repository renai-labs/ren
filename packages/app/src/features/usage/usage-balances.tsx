import type { BillingSummary } from "@ren/client"
import { IconChevronRight } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { formatUsd } from "@ren/ui/format"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { useShapeId } from "../../components/page.js"
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
    <Link to="/settings/billing" data-slot="usage-credits" className={item}>
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

export function UsageBalances() {
  const { api } = RouterContext.useRouterContext()
  const billing = useQuery({ ...api.billing.get.queryOptions(), retry: false })
  const shapeId = useShapeId("usage-balances")
  const summary = billing.isPending ? sampleBilling : billing.data
  if (!summary) return null
  return (
    <Loading id={shapeId} loading={billing.isPending} label="Loading credits">
      <Credits billing={summary} />
    </Loading>
  )
}
