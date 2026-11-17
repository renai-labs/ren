import { LegendList } from "@legendapp/list/react-native"
import { ChatFilters, Debounce, SessionPages } from "@ren/client/react"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { Drawer } from "expo-router/drawer"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import CubeIcon from "react-native-heroicons/mini/CubeIcon"
import FunnelIcon from "react-native-heroicons/mini/FunnelIcon"
import { Button } from "#components/button"
import {
  FilterChips,
  FilterOptions,
  FilterRows,
  isFiltered,
  type FilterProperty,
  type Filters,
} from "#components/filters"
import { HeaderActions, HeaderButton } from "#components/header-button"
import { Icon } from "#components/icon"
import { SheetTitle } from "#components/option-sheet"
import { Sheet } from "#components/sheet"
import { SearchField } from "#components/search-field"
import { Text } from "#components/text"
import { ChatRow } from "#features/chat/chat-row"
import { NewChatButton } from "#features/chat/new-chat-button"
import { Api } from "#lib/api"
import { Auth } from "#lib/auth"

const properties = (
  spaces: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): ReadonlyArray<FilterProperty> => [
  {
    key: "space",
    label: "Space",
    any: "All spaces",
    options: spaces.map((space) => ({
      value: space.id,
      label: space.name,
      icon: <Icon as={CubeIcon} className="size-4 text-muted-foreground" />,
    })),
  },
  { key: "status", label: "Status", any: "Any", single: true, options: ChatFilters.statuses },
  { key: "origin", label: "Started from", any: "Anywhere", options: ChatFilters.origins },
  { key: "updated", label: "Updated", any: "Any time", single: true, options: ChatFilters.updated },
]

function FilterSheet(props: {
  readonly open: boolean
  readonly properties: ReadonlyArray<FilterProperty>
  readonly filters: Filters
  readonly onChange: (filters: Filters) => void
  readonly onClose: () => void
}) {
  const [page, setPage] = useState<string>()
  const property = props.properties.find((each) => each.key === page)
  const close = () => {
    setPage(undefined)
    props.onClose()
  }
  return (
    <Sheet open={props.open} onClose={close}>
      {property ? (
        <FilterOptions
          property={property}
          selected={props.filters[property.key] ?? []}
          onChange={(values) => props.onChange({ ...props.filters, [property.key]: values })}
          onBack={() => setPage(undefined)}
        />
      ) : (
        <>
          <SheetTitle>Filter chats</SheetTitle>
          <FilterRows properties={props.properties} filters={props.filters} onOpen={setPage} />
          <View className="flex-row gap-2 px-5 pt-3">
            <Button variant="secondary" className="flex-1" onPress={() => props.onChange({})}>
              <Text>Reset</Text>
            </Button>
            <Button className="flex-1" onPress={close}>
              <Text>Done</Text>
            </Button>
          </View>
        </>
      )}
    </Sheet>
  )
}

function useChatFilters() {
  const [filters, setFilters] = useState<Filters>({})
  const userId = useQuery(Auth.sessionOptions).data?.user.id ?? ""
  const spaces = useQuery(Api.query.space.list.queryOptions({ joined: true, page: 1, pageSize: 100 })).data?.items
  return {
    filters,
    setFilters,
    properties: properties(spaces ?? []),
    filtered: isFiltered(filters),
    query: ChatFilters.toFilter(filters, userId),
  }
}

function FilterButton(props: {
  readonly properties: ReadonlyArray<FilterProperty>
  readonly filters: Filters
  readonly filtered: boolean
  readonly onChange: (filters: Filters) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Drawer.Screen
        options={{
          headerRight: () => (
            <HeaderActions>
              <HeaderButton
                icon={FunnelIcon}
                label={props.filtered ? "Filter chats, filters on" : "Filter chats"}
                dot={props.filtered}
                onPress={() => setOpen(true)}
              />
            </HeaderActions>
          ),
        }}
      />
      <FilterSheet
        open={open}
        properties={props.properties}
        filters={props.filters}
        onChange={props.onChange}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

function Empty(props: {
  readonly search: string
  readonly filtered: boolean
  readonly onClear: () => void
  readonly onNew: () => void
}) {
  if (props.search || props.filtered)
    return (
      <View className="items-center gap-3 p-6">
        <Text className="text-center text-muted-foreground">
          {props.search ? `No chats match “${props.search}”.` : "No chats match these filters."}
        </Text>
        <Button variant="outline" onPress={props.onClear}>
          <Text>{props.search ? "Clear search" : "Clear filters"}</Text>
        </Button>
      </View>
    )
  return (
    <View className="items-center gap-3 p-6">
      <Text className="text-center text-muted-foreground">Your chats with Ren show up here.</Text>
      <Button onPress={props.onNew}>
        <Text>New chat</Text>
      </Button>
    </View>
  )
}

export default function Chats() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const needle = Debounce.useValue(search.trim(), 250)
  const chosen = useChatFilters()
  const pages = useInfiniteQuery({
    ...SessionPages.options(Api.client, { ...chosen.query, ...(needle && { search: needle }) }),
    placeholderData: keepPreviousData,
  })
  const [pulling, setPulling] = useState(false)
  const chats = pages.data?.pages.flatMap((page) => page.items) ?? []

  const refresh = async () => {
    setPulling(true)
    await pages.refetch()
    setPulling(false)
  }

  return (
    <View className="flex-1 bg-background">
      <FilterButton
        properties={chosen.properties}
        filters={chosen.filters}
        filtered={chosen.filtered}
        onChange={chosen.setFilters}
      />
      <View className="px-4 pb-3">
        <SearchField value={search} label="Search chats" onChange={setSearch} />
      </View>
      <FilterChips properties={chosen.properties} filters={chosen.filters} onChange={chosen.setFilters} />
      {pages.isPending && pages.fetchStatus === "paused" ? (
        <Text className="p-6 text-center text-muted-foreground">
          You’re offline. Your chats load when you reconnect.
        </Text>
      ) : null}
      {pages.isPending && pages.fetchStatus === "fetching" ? (
        <ActivityIndicator colorClassName="accent-muted-foreground" className="mt-8" />
      ) : null}
      {pages.isError ? (
        <View className="items-center gap-3 p-6">
          <Text className="text-center">Couldn’t load your chats.</Text>
          <Button variant="outline" onPress={() => void pages.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : null}
      {pages.isSuccess ? (
        <LegendList
          data={chats}
          keyExtractor={(chat) => chat.id}
          renderItem={(row) => (
            <ChatRow
              chat={row.item}
              time
              onPress={() => router.navigate({ pathname: "/chat/[id]", params: { id: row.item.id } })}
            />
          )}
          estimatedItemSize={44}
          contentContainerClassName="pb-28"
          recycleItems
          keyboardDismissMode="on-drag"
          refreshing={pulling}
          onRefresh={() => void refresh()}
          onEndReached={() => {
            if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage()
          }}
          ListEmptyComponent={
            <Empty
              search={needle}
              filtered={chosen.filtered}
              onClear={() => (needle ? setSearch("") : chosen.setFilters({}))}
              onNew={() => router.navigate("/")}
            />
          }
          ListFooterComponent={
            pages.isFetchingNextPage ? (
              <ActivityIndicator colorClassName="accent-muted-foreground" className="py-4" />
            ) : null
          }
        />
      ) : null}
      <View className="absolute inset-x-0 bottom-0 items-end px-5 pb-safe-offset-5" pointerEvents="box-none">
        <NewChatButton />
      </View>
    </View>
  )
}
