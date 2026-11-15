import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@ren/ui/button"
import { FactoryDashboard } from "./factory-view.js"
import { PageActions } from "../../components/page.js"
import { PeriodSelect } from "../../components/period-select.js"
import { Insights } from "../../lib/insights.js"
import { isSoftwareFactory } from "../../lib/factory.js"
import { OverviewActivity } from "./overview-activity.js"
import { OverviewAttention } from "./overview-attention.js"
import { OverviewRecent } from "./overview-recent.js"
import { OverviewSummary } from "./overview-summary.js"
import { useSpace } from "./use-space.js"

export function SpaceOverviewTab(props: { period: Insights.Period; onPeriod: (period: Insights.Period) => void }) {
  const space = useSpace()
  if (isSoftwareFactory(space)) return <FactoryDashboard space={space} />
  return (
    <>
      <PageActions>
        <Link
          to="/spaces/$spaceId/usage"
          params={{ spaceId: space.id }}
          search={{ period: props.period }}
          className={buttonVariants({ variant: "ghost" })}
        >
          See usage
        </Link>
        <PeriodSelect value={props.period} options={Insights.periods} onChange={props.onPeriod} />
      </PageActions>
      <OverviewSummary spaceId={space.id} period={props.period} />
      <OverviewActivity spaceId={space.id} period={props.period} />
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <OverviewAttention spaceId={space.id} />
        <OverviewRecent spaceId={space.id} period={props.period} />
      </div>
    </>
  )
}
