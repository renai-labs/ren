import { ListPagination } from "@/components/ren/list-pagination"
import { Page } from "@/components/ren/page"
import { ScheduleGrid, ScheduleToolbar } from "@/components/ren/schedule-grid"
import { pageSize } from "@/lib/api"
import { useSchedulesPage } from "@/routes/schedules/use-schedules-page"

export function SchedulesPage() {
  const page = useSchedulesPage()
  return (
    <Page
      title="Scheduled"
      description="Work that starts on a schedule instead of a message."
      actions={<ScheduleToolbar list={page} />}
      footer={<ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="schedule" />}
    >
      <ScheduleGrid list={page} />
    </Page>
  )
}
