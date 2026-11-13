import type { SpaceInfo } from "@ren/client"
import { IconEye, IconLock, IconPlus, IconUsers } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Tabs } from "@ren/ui/tabs"
import { FilterMenu, passes, type Filters } from "../../components/filter-menu.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { Page, PageTabsList, PageTabsTrigger, TableSample, useShapeId } from "../../components/page.js"
import { LoadMore } from "../../components/load-more.js"
import { Loading } from "@ren/ui/loading"
import { pageSize, pickerPageSize } from "../../lib/pagination.js"
import { Pages } from "../../lib/pages.js"
import { Search } from "../../lib/search.js"
import { NewSpaceDialog } from "../../components/new-space-dialog.js"
import { SpacesTable } from "./spaces-table.js"
import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const route = getRouteApi("/_authed/_shell/spaces/")

const isPrivate = (space: SpaceInfo) => space.kind === "private"

export function SpacesPage() {
  const { api, client, queryClient } = RouterContext.useRouterContext()
  const tab = route.useSearch({ select: (search) => search.tab ?? "your" })
  const navigate = route.useNavigate()
  const pickerKey = api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }).queryKey
  const list = useInfiniteQuery({
    ...Pages.spaces(client),
    initialData: () => {
      const picked = queryClient.getQueryData(pickerKey)
      return picked && picked.total <= picked.items.length
        ? { pages: [{ ...picked, pageSize, items: picked.items.slice(0, pageSize) }], pageParams: [1] }
        : undefined
    },
    initialDataUpdatedAt: () => queryClient.getQueryState(pickerKey)?.dataUpdatedAt,
    ...Loader.required,
  })
  const shapeId = useShapeId("spaces")
  const [creating, setCreating] = useState(false)
  const spaces = list.data?.pages.flatMap((page) => page.items)
  const [filters, setFilters] = useState<Filters>({})
  const [query, setQuery] = useState("")
  const shown = (spaces ?? [])
    .filter((space) => (tab === "all" ? !isPrivate(space) : space.membershipId !== null))
    .filter((space) => Search.matches(query, space.name, space.description))
    .filter((space) => passes(filters, { visibility: [isPrivate(space) ? "private" : "shared"] }))
  return (
    <Page
      title="Spaces"
      description="Each space gives a team its own credentials, apps and agents."
      leading={
        <Tabs
          value={tab}
          onValueChange={(value: string) =>
            void navigate({ search: value === "all" ? { tab: "all" } : {}, replace: true })
          }
        >
          <PageTabsList>
            <PageTabsTrigger value="your">Your spaces</PageTabsTrigger>
            <PageTabsTrigger value="all">All spaces</PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
      actions={
        <>
          <ToolbarSearch label="Search spaces" value={query} onChange={setQuery} />
          <FilterMenu
            label="Filter spaces"
            properties={[
              {
                key: "visibility",
                label: "Visibility",
                any: "All spaces",
                icon: IconEye,
                single: true,
                options: [
                  { value: "shared", label: "Shared", icon: IconUsers },
                  { value: "private", label: "Private", icon: IconLock },
                ],
              },
            ]}
            value={filters}
            onChange={setFilters}
          />
          <Button onClick={() => setCreating(true)}>
            <IconPlus data-icon="inline-start" />
            New space
          </Button>
          <NewSpaceDialog open={creating} onOpenChange={setCreating} />
        </>
      }
    >
      <Loading id={shapeId} loading={!spaces} label="Loading spaces">
        {spaces ? (
          <SpacesTable
            spaces={shown}
            browsing={tab === "all"}
            empty={Search.empty(query, tab === "all" ? "No shared spaces yet." : "You’re not in any space yet.")}
          />
        ) : (
          <TableSample columns={["Space", "Description", "Members", ""]} />
        )}
      </Loading>
      <LoadMore more={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
    </Page>
  )
}
