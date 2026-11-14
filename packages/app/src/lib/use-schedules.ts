import { useState } from "react"
import type { ScheduleInfo } from "@ren/client"
import { keepPreviousData, useInfiniteQuery, useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import type { Filters } from "../components/filter-menu.js"
import { useDebouncedValue } from "./use-debounced-value.js"
import { useNow } from "./use-now.js"
import { useSpaces } from "./use-spaces.js"
import { errorMessage } from "./errors.js"
import { Pages } from "./pages.js"
import { localTimeZone, scheduleListInput, type ScheduleSearch } from "./schedules.js"
import { RouterContext } from "./router-context.js"
import { Loader } from "./loader.js"

export type Schedules = ReturnType<typeof useSchedules>

const filtersOf = (search: ScheduleSearch): Filters =>
  Object.fromEntries(Object.entries(search.filters ?? {}).map((entry) => [entry[0], [...entry[1]]]))

export function useSchedules(options: {
  search: ScheduleSearch
  spaceId?: string
  setSearch: (update: Partial<ScheduleSearch>, navigation?: { readonly replace?: boolean }) => void
}) {
  const { api, client } = RouterContext.useRouterContext()
  const search = options.search
  const spaces = useSpaces()
  const now = useNow()
  const [query, setQuery] = useState("")
  const text = useDebouncedValue(query.trim(), 250)
  const pages = useInfiniteQuery({
    ...Pages.schedules(client, scheduleListInput(search, { text, spaceId: options.spaceId })),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
  const items = pages.data?.pages.flatMap((page) => page.items)
  const [sheet, setSheet] = useState<{ open: boolean; key: number; schedule: ScheduleInfo | undefined }>({
    open: false,
    key: 0,
    schedule: undefined,
  })
  const pause = useMutation(api.schedule.pause.mutationOptions())
  const resume = useMutation(api.schedule.resume.mutationOptions())
  const archive = useMutation(api.schedule.archive.mutationOptions())
  const [deleting, setDeleting] = useState<ScheduleInfo>()
  const filters = filtersOf(search)
  const toggling = (schedule: ScheduleInfo) =>
    (pause.isPending && pause.variables.id === schedule.id) || (resume.isPending && resume.variables.id === schedule.id)
  return {
    schedules: items,
    stale: pages.isPlaceholderData,
    more: pages.hasNextPage,
    loadingMore: pages.isFetchingNextPage,
    loadMore: () => void pages.fetchNextPage(),
    filtered: text !== "" || Object.values(filters).some((values) => values.length > 0),
    spaceId: options.spaceId,
    spaces: spaces.joined,
    spaceName: (spaceId: string) => (options.spaceId ? undefined : spaces.spaceName(spaceId)),
    now,
    zone: localTimeZone(),
    query,
    setQuery,
    filters,
    setFilters: (next: Filters) =>
      options.setSearch({
        filters: Object.values(next).some((values) => values.length > 0) ? next : undefined,
      }),
    sheet,
    create: () => setSheet((previous) => ({ open: true, key: previous.key + 1, schedule: undefined })),
    edit: (schedule: ScheduleInfo) => setSheet((previous) => ({ open: true, key: previous.key + 1, schedule })),
    closeSheet: () => setSheet((previous) => ({ ...previous, open: false })),
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
        () => toast.success("Schedule deleted"),
        (error: unknown) => toast.error("Could not delete the schedule", { description: errorMessage(error) }),
      ),
  }
}
