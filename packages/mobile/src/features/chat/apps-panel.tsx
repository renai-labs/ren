import type { Composer } from "@ren/chat"
import { Apps } from "@ren/client"
import { AppRegistryPages, SpaceApps } from "@ren/client/react"
import { Search } from "@ren/util/search"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import ChevronLeftIcon from "react-native-heroicons/mini/ChevronLeftIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import { AppIcon } from "#components/app-icon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { useMenuSheet } from "#components/menu-sheet"
import { SearchField } from "#components/search-field"
import { Text } from "#components/text"
import { ConnectBody, StatusDot, watchStatus } from "#features/chat/app-connect"
import { Api } from "#lib/api"

type Step =
  | { readonly kind: "list" }
  | { readonly kind: "catalog" }
  | { readonly kind: "connect"; readonly appId: string }

interface Row {
  readonly app: Apps.CatalogApp
  readonly status: Apps.Status
}

function PanelHeader(props: { readonly title: string; readonly onBack?: () => void }) {
  return (
    <View className="flex-row items-center gap-1 px-3 pb-2">
      {props.onBack ? (
        <Button variant="ghost" size="icon" className="size-9" aria-label="Back" onPress={props.onBack}>
          <Icon as={ChevronLeftIcon} className="size-5" />
        </Button>
      ) : (
        <View className="w-2" />
      )}
      <Text role="heading" aria-level={2} className="flex-1 text-base font-semibold" numberOfLines={1}>
        {props.title}
      </Text>
    </View>
  )
}

function AppRow(props: { readonly row: Row; readonly onOpen: () => void; readonly onConnect: () => void }) {
  const action = Apps.statusAction[props.row.status]
  return (
    <View className="min-h-14 flex-row items-center gap-2 pr-5">
      <Pressable
        role="menuitem"
        className="min-h-14 min-w-0 flex-1 flex-row items-center gap-3 pl-5 active:bg-accent"
        onPress={props.onOpen}
      >
        <AppIcon name={props.row.app.name} icon={props.row.app.icon} className="size-8" />
        <View className="min-w-0 flex-1">
          <Text className="font-medium" numberOfLines={1}>
            {props.row.app.name}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <StatusDot status={props.row.status} />
            <Text variant="muted" numberOfLines={1}>
              {Apps.statusLabel[props.row.status]}
            </Text>
          </View>
        </View>
      </Pressable>
      {action ? (
        <Button size="sm" variant="secondary" onPress={props.onConnect}>
          <Text>{action}</Text>
        </Button>
      ) : null}
    </View>
  )
}

function CatalogRow(props: {
  readonly app: Apps.CatalogApp
  readonly managed: boolean
  readonly onPick: (appId: string) => void
}) {
  return (
    <Pressable
      role="menuitem"
      className="min-h-14 flex-row items-center gap-3 px-5 active:bg-accent"
      onPress={() => props.onPick(props.app.id)}
    >
      <AppIcon name={props.app.name} icon={props.app.icon} className="size-8" />
      <View className="min-w-0 flex-1">
        <Text className="font-medium" numberOfLines={1}>
          {props.app.name}
        </Text>
        <Text variant="muted" numberOfLines={1}>
          {props.app.description}
        </Text>
      </View>
      {props.managed ? <Text variant="muted">Ren credits</Text> : null}
      <Icon as={ChevronRightIcon} className="size-4 text-muted-foreground" />
    </Pressable>
  )
}

function CatalogResults(props: {
  readonly query: string
  readonly added: ReadonlySet<string>
  readonly empty: string
  readonly heading?: string | undefined
  readonly onPick: (appId: string) => void
}) {
  const search = AppRegistryPages.useSearch(
    { client: Api.client, api: Api.query, query: props.query, added: props.added },
    Search.matches,
  )
  if (search.loading) return <ActivityIndicator colorClassName="accent-muted-foreground" className="py-6" />
  if (search.found.length === 0)
    return props.heading ? null : (
      <Text className="px-5 py-6 text-center text-sm text-muted-foreground">
        {Search.empty(props.query, props.empty)}
      </Text>
    )
  return (
    <>
      {props.heading ? (
        <Text className="px-5 pt-3 pb-1 text-xs font-medium text-muted-foreground">{props.heading}</Text>
      ) : null}
      {search.found.map((app) => (
        <CatalogRow key={app.id} app={app} managed={search.managed(app.id)} onPick={props.onPick} />
      ))}
      {search.more ? (
        <Button variant="ghost" className="mx-5 my-2" disabled={search.loadingMore} onPress={search.loadMore}>
          {search.loadingMore ? <ActivityIndicator size="small" /> : null}
          <Text>Show more</Text>
        </Button>
      ) : null}
    </>
  )
}

function AppsList(props: {
  readonly rows: ReadonlyArray<Row>
  readonly onMention: (app: Apps.CatalogApp) => void
  readonly onConnect: (appId: string) => void
  readonly onAdd: () => void
}) {
  const [query, setQuery] = useState("")
  const searching = query.trim() !== ""
  const shown = props.rows.filter((row) => Search.matches(query, row.app.name, row.app.description))
  return (
    <>
      <PanelHeader title="Apps this chat can use" />
      <View className="px-5 pb-2">
        <SearchField label="Search apps" value={query} onChange={setQuery} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" role="menu">
        {props.rows.length === 0 && !searching ? (
          <Text className="px-5 py-6 text-center text-muted-foreground">
            No apps yet. Add the apps Ren can use here.
          </Text>
        ) : null}
        {shown.map((row) => (
          <AppRow
            key={row.app.id}
            row={row}
            onOpen={() => (Apps.isReady(row.status) ? props.onMention(row.app) : props.onConnect(row.app.id))}
            onConnect={() => props.onConnect(row.app.id)}
          />
        ))}
        {searching ? (
          <CatalogResults
            query={query}
            added={new Set(props.rows.map((row) => row.app.id))}
            empty="No apps"
            heading={shown.length > 0 ? "More apps" : undefined}
            onPick={props.onConnect}
          />
        ) : null}
      </ScrollView>
      <View className="px-5 pt-2">
        <Button variant={props.rows.length === 0 ? "default" : "secondary"} onPress={props.onAdd}>
          <Icon as={PlusIcon} className="size-5 text-primary-foreground" />
          <Text>{props.rows.length === 0 ? "Add apps" : "Add more apps"}</Text>
        </Button>
      </View>
    </>
  )
}

function AppsCatalog(props: {
  readonly added: ReadonlySet<string>
  readonly onPick: (appId: string) => void
  readonly onBack: () => void
}) {
  const [query, setQuery] = useState("")
  return (
    <>
      <PanelHeader title="Add apps" onBack={props.onBack} />
      <View className="px-5 pb-2">
        <SearchField label="Search apps" value={query} onChange={setQuery} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" role="menu">
        <CatalogResults query={query} added={props.added} empty="This space has every app" onPick={props.onPick} />
      </ScrollView>
    </>
  )
}

function AppsPanel(props: { readonly spaceId: string; readonly onMention: (app: Composer.MentionedApp) => void }) {
  const menu = useMenuSheet()
  const [view, setView] = useState<Step>({ kind: "list" })
  const space = useQuery(Api.query.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const apps = SpaceApps.useSpace(Api.query, {
    spaceId: props.spaceId,
    space: space.data,
    appIds: view.kind === "connect" ? [view.appId] : [],
  })
  const rows = [...new Set(apps.profiles.map((profile) => profile.appId))].flatMap((appId): ReadonlyArray<Row> => {
    const app = apps.app(appId)
    return app ? [{ app, status: apps.status(appId) }] : []
  })
  const connecting = view.kind === "connect" ? apps.app(view.appId) : undefined
  const from = apps.from
  if (apps.pending || !space.data || !from)
    return <ActivityIndicator colorClassName="accent-muted-foreground" className="py-8" />
  if (view.kind === "catalog")
    return (
      <AppsCatalog
        added={new Set(rows.map((row) => row.app.id))}
        onPick={(appId) => setView({ kind: "connect", appId })}
        onBack={() => setView({ kind: "list" })}
      />
    )
  if (view.kind === "connect")
    return connecting ? (
      <>
        <PanelHeader title="Apps this chat can use" onBack={() => setView({ kind: "list" })} />
        <ConnectBody
          app={connecting}
          space={space.data}
          from={from}
          status={apps.status(connecting.id)}
          onFinish={() => {
            setView({ kind: "list" })
            void watchStatus({ refresh: () => apps.refresh(connecting.id), before: apps.status(connecting.id) })
          }}
        />
      </>
    ) : (
      <ActivityIndicator colorClassName="accent-muted-foreground" className="py-8" />
    )
  return (
    <AppsList
      rows={rows}
      onMention={(app) => {
        props.onMention({
          id: app.id,
          slug: app.slug,
          name: app.name,
          description: app.description,
          icon: app.icon,
          brandColor: app.brandColor,
        })
        menu.close()
      }}
      onConnect={(appId) => setView({ kind: "connect", appId })}
      onAdd={() => setView({ kind: "catalog" })}
    />
  )
}

export { AppsPanel }
