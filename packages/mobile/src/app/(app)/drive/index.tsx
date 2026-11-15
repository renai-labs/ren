import { LegendList } from "@legendapp/list/react-native"
import type { FileSystemAction, FileSystemEntry, FileSystemPage, SpaceInfo } from "@ren/client"
import { DriveQuery } from "@ren/client/react"
import { Bytes } from "@ren/util/bytes"
import { FileName } from "@ren/util/file-name"
import { Search } from "@ren/util/search"
import IconX from "@tabler/icons-react-native/IconX"
import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import ArrowDownTrayIcon from "react-native-heroicons/mini/ArrowDownTrayIcon"
import ArrowUpTrayIcon from "react-native-heroicons/mini/ArrowUpTrayIcon"
import CubeIcon from "react-native-heroicons/mini/CubeIcon"
import FolderIcon from "react-native-heroicons/mini/FolderIcon"
import LockClosedIcon from "react-native-heroicons/mini/LockClosedIcon"
import MagnifyingGlassIcon from "react-native-heroicons/mini/MagnifyingGlassIcon"
import TrashIcon from "react-native-heroicons/mini/TrashIcon"
import WindowIcon from "react-native-heroicons/mini/WindowIcon"
import { HeaderActions, HeaderButton, MenuButton } from "#components/header-button"
import { FileIcon } from "#components/file-icon"
import { Icon } from "#components/icon"
import { SearchField } from "#components/search-field"
import { Text } from "#components/text"
import { DriveCrumbs } from "#features/drive/drive-crumbs"
import { MenuSheet } from "#components/menu-sheet"
import { DriveRow } from "#features/drive/drive-row"
import { QueryStatus } from "#components/query-status"
import { DriveUploads, useDriveUploads } from "#features/drive/drive-upload"
import { Api } from "#lib/api"
import { DriveFiles } from "#lib/drive-files"

type Row =
  | { readonly kind: "label"; readonly title: string }
  | { readonly kind: "artifacts" }
  | { readonly kind: "space"; readonly space: SpaceInfo }
  | { readonly kind: "entry"; readonly entry: FileSystemEntry }

interface Place {
  readonly space: string | undefined
  readonly folder: string
}

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

const keyOf = (row: Row) => {
  if (row.kind === "entry") return row.entry.path
  if (row.kind === "label") return `label:${row.title}`
  return row.kind === "space" ? row.space.id : row.kind
}

const searchLabel = (place: Place) => (place.space || place.folder ? "Search this folder" : "Search Drive")

const titleOf = (place: Place, spaceName: string | undefined) => {
  if (place.folder) return FileName.base(place.folder)
  return place.space ? (spaceName ?? "Space") : "Drive"
}

const metaOf = (entry: FileSystemEntry) =>
  [
    ...(typeof entry.size === "number" ? [Bytes.format(entry.size)] : []),
    ...(entry.modifiedAt ? [dateFormat.format(new Date(entry.modifiedAt))] : []),
  ].join(" · ")

const scopeOf = (place: Place) => (place.space ? { spaceId: place.space } : {})

function ListRow(props: {
  readonly row: Row
  readonly place: Place
  readonly onMenu: (entry: FileSystemEntry) => void
}) {
  const router = useRouter()
  const row = props.row
  const space = props.place.space
  if (row.kind === "label")
    return (
      <Text role="heading" aria-level={2} className="px-4 pt-5 pb-1 text-sm font-medium text-muted-foreground">
        {row.title}
      </Text>
    )
  if (row.kind === "artifacts")
    return (
      <DriveRow
        media={<Icon as={WindowIcon} className="size-5 text-muted-foreground" />}
        title="Artifacts"
        onPress={() => router.push({ pathname: "/drive/artifacts", params: { space } })}
      />
    )
  if (row.kind === "space")
    return (
      <DriveRow
        media={
          <Icon
            as={row.space.kind === "private" ? LockClosedIcon : CubeIcon}
            className="size-5 text-muted-foreground"
          />
        }
        title={row.space.name}
        onPress={() => router.push({ pathname: "/drive", params: { space: row.space.id } })}
      />
    )
  const entry = row.entry
  const name = FileName.base(entry.path)
  if (entry.type === "directory")
    return (
      <DriveRow
        media={<Icon as={FolderIcon} className="size-5 text-muted-foreground" />}
        title={name}
        onPress={() => router.push({ pathname: "/drive", params: { space, folder: entry.path } })}
      />
    )
  return (
    <DriveRow
      media={<FileIcon name={name} mime={entry.mime} />}
      title={name}
      meta={metaOf(entry)}
      onPress={() => router.push({ pathname: "/drive/file", params: { space, path: entry.path } })}
      onMenu={() => props.onMenu(entry)}
    />
  )
}

function EntryMenu(props: {
  readonly entry: FileSystemEntry | undefined
  readonly open: boolean
  readonly place: Place
  readonly actions: ReadonlyArray<FileSystemAction>
  readonly onClose: () => void
}) {
  const remove = useMutation(Api.query.files.delete.mutationOptions())
  const path = props.entry?.path ?? ""
  const name = FileName.base(path)
  const scope = scopeOf(props.place)
  return (
    <MenuSheet
      key={path}
      open={props.open}
      title={name}
      items={[
        { label: "Share", icon: ArrowDownTrayIcon, onPress: () => DriveFiles.share({ ...scope, path }) },
        ...(props.actions.includes("remove")
          ? [
              {
                label: "Delete",
                icon: TrashIcon,
                confirm: {
                  title: `Delete ${name}?`,
                  description: "It leaves the drive for everyone, and you can’t undo this.",
                  action: "Delete",
                },
                onPress: () => remove.mutateAsync({ source: "drive" as const, ...scope, path }),
              },
            ]
          : []),
      ]}
      onClose={props.onClose}
    />
  )
}

const rowsOf = (input: {
  readonly place: Place
  readonly query: string
  readonly spaces: ReadonlyArray<SpaceInfo>
  readonly shown: ReadonlyArray<FileSystemEntry>
}): ReadonlyArray<Row> => {
  const pinned = input.place.folder === ""
  const spaces = (pinned && !input.place.space ? input.spaces : [])
    .filter((space) => Boolean(space.membershipId) && Search.matches(input.query, space.name))
    .map((space) => ({ kind: "space" as const, space }))
  const files = input.shown.map((entry) => ({ kind: "entry" as const, entry }))
  const label = (title: string, rows: ReadonlyArray<Row>) =>
    spaces.length > 0 && rows.length > 0 ? [{ kind: "label" as const, title }, ...rows] : rows
  return [
    ...(pinned && Search.matches(input.query, "Artifacts") ? [{ kind: "artifacts" as const }] : []),
    ...label("Spaces", spaces),
    ...label("Files", files),
  ]
}

function Header(props: {
  readonly title: string
  readonly place: Place
  readonly spaceName: string | undefined
  readonly query: string
  readonly actions: ReadonlyArray<FileSystemAction>
  readonly onQuery: (query: string) => void
  readonly onUpload: () => void
}) {
  const [searching, setSearching] = useState(false)
  const root = !props.place.space && !props.place.folder
  return (
    <>
      <Stack.Screen
        options={{
          title: props.title,
          ...(root && { headerLeft: () => <MenuButton /> }),
          headerRight: () => (
            <HeaderActions>
              <HeaderButton
                icon={searching ? IconX : MagnifyingGlassIcon}
                label={searching ? "Close search" : searchLabel(props.place)}
                onPress={() => {
                  setSearching((open) => !open)
                  props.onQuery("")
                }}
              />
              {props.actions.includes("upload") ? (
                <HeaderButton icon={ArrowUpTrayIcon} label="Upload" onPress={props.onUpload} />
              ) : null}
            </HeaderActions>
          ),
        }}
      />
      {root ? null : <DriveCrumbs {...props.place} spaceName={props.spaceName} />}
      {searching ? (
        <View className="px-4 pb-3">
          <SearchField label={searchLabel(props.place)} value={props.query} onChange={props.onQuery} />
        </View>
      ) : null}
    </>
  )
}

function Listing(props: {
  readonly pages: UseInfiniteQueryResult<InfiniteData<FileSystemPage>>
  readonly entries: ReadonlyArray<FileSystemEntry>
  readonly actions: ReadonlyArray<FileSystemAction>
  readonly spaces: ReadonlyArray<SpaceInfo>
  readonly place: Place
  readonly query: string
}) {
  const [pulling, setPulling] = useState(false)
  const [menu, setMenu] = useState<{ readonly entry: FileSystemEntry; readonly open: boolean }>()
  const pages = props.pages
  const shown = props.entries.filter((entry) => Search.matches(props.query, FileName.base(entry.path)))
  const refresh = async () => {
    setPulling(true)
    await pages.refetch()
    setPulling(false)
  }
  return (
    <>
      <LegendList
        data={rowsOf({ place: props.place, query: props.query, spaces: props.spaces, shown })}
        keyExtractor={keyOf}
        renderItem={(item) => (
          <ListRow row={item.item} place={props.place} onMenu={(entry) => setMenu({ entry, open: true })} />
        )}
        estimatedItemSize={56}
        recycleItems
        keyboardDismissMode="on-drag"
        contentContainerClassName="pb-28"
        refreshing={pulling}
        onRefresh={() => void refresh()}
        onEndReached={() => {
          if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage()
        }}
        ListFooterComponent={
          <>
            {pages.isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
            {shown.length === 0 && !pages.hasNextPage ? (
              <Text className="p-6 text-center text-muted-foreground">
                {Search.empty(props.query, props.place.folder ? "This folder is empty." : "No files yet.")}
              </Text>
            ) : null}
          </>
        }
      />
      <EntryMenu
        entry={menu?.entry}
        open={menu?.open === true}
        place={props.place}
        actions={props.actions}
        onClose={() => setMenu((current) => current && { ...current, open: false })}
      />
    </>
  )
}

export default function DriveScreen() {
  const params = useLocalSearchParams<{ space?: string; folder?: string }>()
  const place = { space: params.space || undefined, folder: params.folder ?? "" }
  const pages = useInfiniteQuery(DriveQuery.pages(Api.client, place))
  const spaces = useQuery(Api.query.space.list.queryOptions({ page: 1, pageSize: 100 })).data?.items ?? []
  const [query, setQuery] = useState("")
  const [uploading, setUploading] = useState(false)
  const loaded = pages.data?.pages ?? []
  const entries = loaded.flatMap((page) => page.entries)
  const actions = loaded.at(0)?.actions ?? []
  const spaceName = spaces.find((each) => each.id === place.space)?.name
  const title = titleOf(place, spaceName)
  const uploads = useDriveUploads({
    ...place,
    taken: entries.map((entry) => entry.path),
    onDone: () => void pages.refetch(),
  })

  return (
    <View className="flex-1 bg-background">
      <Header
        title={title}
        place={place}
        spaceName={spaceName}
        query={query}
        actions={actions}
        onQuery={setQuery}
        onUpload={() => setUploading(true)}
      />
      <DriveUploads uploads={uploads.uploads} onDismiss={uploads.dismiss} />
      <QueryStatus
        result={pages}
        offline="You’re offline. Your files load when you reconnect."
        failure="Could not open this folder"
        onRetry={() => void pages.refetch()}
      />
      {pages.data ? (
        <Listing pages={pages} entries={entries} actions={actions} spaces={spaces} place={place} query={query} />
      ) : null}
      <MenuSheet
        open={uploading}
        title={`Upload to ${title}`}
        items={uploads.items}
        onClose={() => setUploading(false)}
      />
    </View>
  )
}
