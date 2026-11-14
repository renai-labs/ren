import { useState } from "react"
import type { ScheduleInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { IconPencil, IconPlayerPlay } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { Breadcrumb } from "../../components/breadcrumb.js"
import { Page, PageSkeleton, TableSample } from "../../components/page.js"
import { ScheduleSheet } from "../../components/schedule-sheet.js"
import { errorMessage } from "../../lib/errors.js"
import { Loader } from "../../lib/loader.js"
import { RouterContext } from "../../lib/router-context.js"
import { describe, localTimeZone, runColumns, statusOf } from "../../lib/schedules.js"
import { Seed } from "../../lib/seed.js"
import { useNow } from "../../lib/use-now.js"
import { ScheduleRuns } from "./schedule-runs.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/automations/schedules/$scheduleId/")

function Trail(props: { spaceId: string; name: string }) {
  return (
    <Breadcrumb.Root
      ancestors={[
        {
          key: "automations",
          content: (
            <Link to="/spaces/$spaceId/automations" params={{ spaceId: props.spaceId }}>
              Automations
            </Link>
          ),
        },
      ]}
    >
      <span className="block max-w-80 truncate">{props.name}</span>
    </Breadcrumb.Root>
  )
}

export function SchedulePage() {
  const { api, queryClient } = RouterContext.useRouterContext()
  const params = route.useParams()
  const schedule = useQuery({
    ...api.schedule.get.queryOptions({ idOrSlug: params.scheduleId }),
    ...Seed.fromList<ScheduleInfo>(queryClient, [api.schedule.list.queryKey()], params.scheduleId),
    ...Loader.required,
  })
  if (!schedule.data)
    return (
      <PageSkeleton title="Schedule" width="full" shape="schedule">
        <TableSample columns={runColumns} />
      </PageSkeleton>
    )
  return <ScheduleView schedule={schedule.data} spaceId={params.spaceId} />
}

function ScheduleView(props: { schedule: ScheduleInfo; spaceId: string }) {
  const { api } = RouterContext.useRouterContext()
  const now = useNow()
  const run = useMutation(api.schedule.run.mutationOptions())
  const [sheet, setSheet] = useState({ open: false, key: 0 })
  const schedule = props.schedule
  const name = schedule.name || schedule.message
  return (
    <Page
      title={name}
      width="full"
      description={`${describe(schedule.when, localTimeZone())} · ${statusOf(schedule, now)}`}
      back={<Trail spaceId={props.spaceId} name={name} />}
    >
      <ScheduleRuns
        schedule={schedule}
        actions={
          <>
            <Button variant="outline" onClick={() => setSheet((previous) => ({ open: true, key: previous.key + 1 }))}>
              <IconPencil data-icon="inline-start" />
              Edit
            </Button>
            <Button
              disabled={run.isPending}
              onClick={() =>
                run.mutate(
                  { id: schedule.id },
                  {
                    onError: (error) => toast.error("Couldn’t run the schedule", { description: errorMessage(error) }),
                  },
                )
              }
            >
              {run.isPending ? <Spinner data-icon="inline-start" /> : <IconPlayerPlay data-icon="inline-start" />}
              Run now
            </Button>
          </>
        }
      />
      <ScheduleSheet
        open={sheet.open}
        version={sheet.key}
        schedule={schedule}
        onClose={() => setSheet((previous) => ({ ...previous, open: false }))}
      />
    </Page>
  )
}
