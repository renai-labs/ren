import type { ReactNode } from "react"
import { Tabs } from "@ren/ui/tabs"
import { PageActions, PageTabs, PageTabsList, PageTabsTrigger } from "../../components/page.js"
import { ScheduleGrid, ScheduleToolbar } from "../../components/schedule-grid.js"
import type { Automations } from "../../lib/automations.js"
import { useSchedules } from "../../lib/use-schedules.js"

type SetSearch = (update: Partial<Automations.Search>, navigation?: { readonly replace?: boolean }) => void

function Schedules(props: { search: Automations.Search; spaceId?: string | undefined; setSearch: SetSearch }) {
  const schedules = useSchedules({
    search: props.search,
    ...(props.spaceId && { spaceId: props.spaceId }),
    setSearch: props.setSearch,
  })
  return (
    <>
      <PageActions>
        <ScheduleToolbar list={schedules} />
      </PageActions>
      <ScheduleGrid list={schedules} />
    </>
  )
}

export function AutomationsView(props: {
  search: Automations.Search
  spaceId?: string | undefined
  setSearch: SetSearch
  webhooks: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageTabs>
        <Tabs
          value={props.search.kind ?? "schedules"}
          onValueChange={(value: string) =>
            props.setSearch(
              { kind: value === "webhooks" ? "webhooks" : undefined, filters: undefined },
              { replace: true },
            )
          }
        >
          <PageTabsList>
            <PageTabsTrigger value="schedules">Schedules</PageTabsTrigger>
            <PageTabsTrigger value="webhooks">Webhooks</PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      </PageTabs>
      {props.search.kind === "webhooks" ? (
        props.webhooks
      ) : (
        <Schedules search={props.search} spaceId={props.spaceId} setSearch={props.setSearch} />
      )}
    </div>
  )
}
