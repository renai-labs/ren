import { useState } from "react"
import type { ScheduleInfo } from "@ren/client"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Filters } from "@/components/ren/filter-menu"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useNow } from "@/hooks/use-now"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage, pageSize, queryClient } from "@/lib/api"
import { currentPage, lastPageAfterRemoval } from "@/lib/pagination"
import { localTimeZone, scheduleListInput, type ScheduleSearch } from "@/lib/schedules"

const refetchList = () =>
  queryClient.refetchQueries({ queryKey: api.schedule.list.queryKey(), type: "active" }, { cancelRefetch: false })

export type Schedules = ReturnType<typeof useSchedules>

export function useSchedules(options: {
  search: ScheduleSearch
  spaceId?: string
  setSearch: (update: Partial<ScheduleSearch>, navigation?: { readonly replace?: boolean }) => void
}) {
  const search = options.search
  const spaces = useSpaces()
  const now = useNow()
  const page = currentPage(search)
  const [query, setQuery] = useState("")
  const text = useDebouncedValue(query.trim(), 250)
  const schedules = useQuery({
    ...api.schedule.list.queryOptions(scheduleListInput(search, { page, pageSize, text, spaceId: options.spaceId })),
    placeholderData: keepPreviousData,
  })
  const [sheet, setSheet] = useState(() => ({
    open: search.schedule !== undefined,
    id: search.schedule,
    key: 0,
  }))
  const listed = schedules.data?.items.find((schedule) => schedule.id === sheet.id)
  const fetched = useQuery({
    ...api.schedule.get.queryOptions({ idOrSlug: sheet.id ?? "" }),
    enabled: sheet.id !== undefined && !listed,
  })
  const editing = listed ?? fetched.data
  const pause = useMutation({ ...api.schedule.pause.mutationOptions(), onSuccess: refetchList })
  const resume = useMutation({ ...api.schedule.resume.mutationOptions(), onSuccess: refetchList })
  const archive = useMutation(api.schedule.archive.mutationOptions())
  const [deleting, setDeleting] = useState<ScheduleInfo>()
  const filters: Filters = Object.fromEntries(
    Object.entries(search.filters ?? {}).map((entry) => [entry[0], [...entry[1]]]),
  )
  const toggling = (schedule: ScheduleInfo) =>
    (pause.isPending && pause.variables.id === schedule.id) || (resume.isPending && resume.variables.id === schedule.id)
  const total = schedules.data?.total ?? 0
  return {
    page,
    total,
    schedules: schedules.data?.items,
    stale: schedules.isPlaceholderData,
    filtered: text !== "" || Object.values(filters).some((values) => values.length > 0),
    spaceId: options.spaceId,
    spaces: spaces.joined,
    spaceName: (spaceId: string) => (options.spaceId ? undefined : spaces.spaceName(spaceId)),
    now,
    zone: localTimeZone(),
    query,
    setQuery: (value: string) => {
      setQuery(value)
      if (search.page) options.setSearch({ page: undefined }, { replace: true })
    },
    filters,
    setFilters: (next: Filters) =>
      options.setSearch({
        page: undefined,
        filters: Object.values(next).some((values) => values.length > 0) ? next : undefined,
      }),
    sheet: {
      open: sheet.open && (sheet.id === undefined || editing !== undefined),
      key: sheet.key,
      schedule: sheet.id === undefined ? undefined : editing,
    },
    create: () => setSheet((previous) => ({ open: true, id: undefined, key: previous.key + 1 })),
    edit: (schedule: ScheduleInfo) => setSheet((previous) => ({ open: true, id: schedule.id, key: previous.key + 1 })),
    closeSheet: () => {
      setSheet((previous) => ({ ...previous, open: false }))
      if (search.schedule) options.setSearch({ schedule: undefined }, { replace: true })
    },
    isActive: (schedule: ScheduleInfo) =>
      toggling(schedule) ? schedule.status !== "active" : schedule.status === "active",
    toggle: (schedule: ScheduleInfo) => {
      if (toggling(schedule)) return
      const onError = (error: Error) =>
        toast.error(schedule.status === "active" ? "Could not pause the schedule" : "Could not resume the schedule", {
          description: errorMessage(error),
        })
      if (schedule.status === "active") pause.mutate({ id: schedule.id }, { onError })
      else resume.mutate({ id: schedule.id }, { onError })
    },
    deleting,
    setDeleting,
    remove: (schedule: ScheduleInfo) =>
      archive.mutateAsync({ id: schedule.id }).then(
        () => {
          toast.success("Schedule deleted")
          const last = lastPageAfterRemoval(page, total, pageSize)
          if (last !== page) options.setSearch({ page: last })
        },
        (error: unknown) => toast.error("Could not delete the schedule", { description: errorMessage(error) }),
      ),
  }
}
