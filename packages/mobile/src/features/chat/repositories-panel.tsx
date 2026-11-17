import { Repositories } from "@ren/chat"
import { SpaceRepositories } from "@ren/client/react"
import { ErrorText } from "@ren/util/error-text"
import { Search } from "@ren/util/search"
import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import { cn } from "cn"
import { useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import ExclamationCircleIcon from "react-native-heroicons/mini/ExclamationCircleIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import { GitHubIcon } from "#components/brand-mark"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { useMenuSheet } from "#components/menu-sheet"
import { SearchField } from "#components/search-field"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { Auth } from "#lib/auth"

function emptyText(listed: Pick<UseQueryResult, "isPending" | "error">, available: number) {
  if (listed.isPending) return "Loading…"
  if (listed.error) return ErrorText.of(listed.error, "Couldn’t list the repositories.")
  if (available === 0) return "Every repository is already in this space"
  return "No matching repositories"
}

function BranchLabel(props: { readonly branch: string | undefined }) {
  return props.branch ? <Text className="shrink-0 font-mono text-xs text-muted-foreground">{props.branch}</Text> : null
}

function PastedRow(props: {
  readonly pasted: Repositories.Parsed
  readonly known: ReadonlySet<string>
  readonly onAdd: () => void
}) {
  const problem = Repositories.problemOf(props.pasted, props.known)
  return (
    <Pressable
      role="button"
      disabled={problem !== undefined}
      className={cn("min-h-12 flex-row items-center gap-3 px-5 active:bg-accent", problem && "opacity-60")}
      onPress={props.onAdd}
    >
      <Icon as={problem ? ExclamationCircleIcon : PlusIcon} className="size-5 text-muted-foreground" />
      <Text className="min-w-0 shrink" numberOfLines={1}>
        {problem ?? `Add ${Repositories.nameOf(props.pasted.repository)}`}
      </Text>
      <BranchLabel branch={problem ? undefined : props.pasted.branch} />
    </Pressable>
  )
}

function RepositoryRow(props: {
  readonly row: Repositories.Row
  readonly checked: boolean
  readonly onToggle: () => void
}) {
  return (
    <Pressable
      role="checkbox"
      aria-checked={props.checked}
      className="min-h-12 flex-row items-center gap-3 px-5 active:bg-accent"
      onPress={props.onToggle}
    >
      <View
        className={cn(
          "size-5 items-center justify-center rounded-sm border border-input",
          props.checked && "border-primary bg-primary",
        )}
      >
        {props.checked ? <Icon as={CheckIcon} className="size-4 text-primary-foreground" /> : null}
      </View>
      <Icon as={GitHubIcon} className="size-4 text-foreground" />
      <Text className="min-w-0 shrink" numberOfLines={1}>
        {props.row.name}
      </Text>
      <BranchLabel branch={props.row.picked.parsed.branch} />
    </Pressable>
  )
}

function RepositoryList(props: {
  readonly search: string
  readonly rows: ReadonlyArray<Repositories.Row>
  readonly repositories: ReadonlyArray<Repositories.Row>
  readonly picked: ReadonlyMap<string, Repositories.Picked>
  readonly known: ReadonlySet<string>
  readonly listed: UseQueryResult<ReadonlyArray<Repositories.Listing>>
  readonly onPick: (
    change: (current: ReadonlyMap<string, Repositories.Picked>) => ReadonlyMap<string, Repositories.Picked>,
  ) => void
  readonly onClear: () => void
}) {
  const pasted = Repositories.parse(props.search)
  const connected = props.listed.data?.some((listing) => listing.installed) ?? true
  if (pasted)
    return (
      <PastedRow
        pasted={pasted}
        known={props.known}
        onAdd={() => {
          props.onPick((current) => Repositories.paste(current, pasted, props.repositories))
          props.onClear()
        }}
      />
    )
  if (props.rows.length === 0 && connected)
    return (
      <Text className="px-5 py-6 text-center text-sm text-muted-foreground">
        {emptyText(props.listed, props.repositories.length)}
      </Text>
    )
  if (props.rows.length === 0)
    return (
      <View className="items-center gap-3 px-5 py-6">
        <Text className="text-center text-sm text-muted-foreground">
          Paste the URL of a public GitHub repository, or connect GitHub to pick from your repositories.
        </Text>
        <Button variant="outline" onPress={() => Auth.openWeb("settings/channels/github")}>
          <Icon as={GitHubIcon} className="size-4 text-muted-foreground" />
          <Text>Connect GitHub</Text>
        </Button>
      </View>
    )
  return props.rows.map((row) => (
    <RepositoryRow
      key={row.key}
      row={row}
      checked={props.picked.has(row.key)}
      onToggle={() => props.onPick((current) => Repositories.toggle(current, row.key, row.picked))}
    />
  ))
}

function RepositoriesPanel(props: { readonly spaceId: string }) {
  const menu = useMenuSheet()
  const listed = useQuery(Api.query.repository.list.queryOptions())
  const space = SpaceRepositories.useReferences(Api.query, props.spaceId)
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<ReadonlyMap<string, Repositories.Picked>>(() => new Map())
  const known = Repositories.knownOf(space.references)
  const repositories = Repositories.candidates(listed.data ?? [], known)
  const rows = Repositories.rows(repositories, picked).filter((row) =>
    Search.matches(search, row.name, row.picked.parsed.repository),
  )
  const add = () => {
    void space.add(Repositories.referencesOf(picked, space.references)).then(menu.close, () => undefined)
  }
  return (
    <>
      <View className="gap-1 px-5 pb-2">
        <Text role="heading" aria-level={2} className="text-base font-semibold">
          Add repositories
        </Text>
        <Text variant="muted">{Repositories.copy}</Text>
      </View>
      <View className="px-5 pb-2">
        <SearchField label="Search or paste https://github.com/owner/repo" value={search} onChange={setSearch} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        <RepositoryList
          search={search}
          rows={rows}
          repositories={repositories}
          picked={picked}
          known={known}
          listed={listed}
          onPick={setPicked}
          onClear={() => setSearch("")}
        />
      </ScrollView>
      {space.error ? (
        <Text className="px-5 pt-2 text-sm text-destructive">
          {ErrorText.of(space.error, "Couldn’t add the repositories.")}
        </Text>
      ) : null}
      <View className="flex-row gap-2 px-5 pt-3">
        <Button variant="secondary" className="flex-1" disabled={space.saving} onPress={menu.close}>
          <Text>Cancel</Text>
        </Button>
        <Button className="flex-1" disabled={picked.size === 0 || space.saving || space.pending} onPress={add}>
          {space.saving ? <ActivityIndicator size="small" /> : null}
          <Text>{picked.size > 1 ? `Add ${picked.size} repositories` : "Add repository"}</Text>
        </Button>
      </View>
    </>
  )
}

export { RepositoriesPanel }
