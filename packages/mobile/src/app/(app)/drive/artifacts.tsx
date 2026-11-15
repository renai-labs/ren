import { LegendList } from "@legendapp/list/react-native"
import type { ArtifactInfo } from "@ren/client"
import { Artifacts } from "@ren/client/react"
import { ErrorText } from "@ren/util/error-text"
import IconLinkOff from "@tabler/icons-react-native/IconLinkOff"
import { useMutation, useQuery } from "@tanstack/react-query"
import { setStringAsync } from "expo-clipboard"
import { useLocalSearchParams } from "expo-router"
import { openBrowserAsync } from "expo-web-browser"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import ArchiveBoxIcon from "react-native-heroicons/mini/ArchiveBoxIcon"
import ArrowTopRightOnSquareIcon from "react-native-heroicons/mini/ArrowTopRightOnSquareIcon"
import LinkIcon from "react-native-heroicons/mini/LinkIcon"
import PencilSquareIcon from "react-native-heroicons/mini/PencilSquareIcon"
import WindowIcon from "react-native-heroicons/mini/WindowIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Input } from "#components/input"
import { Text } from "#components/text"
import { MenuSheet, useMenuSheet } from "#components/menu-sheet"
import { DriveRow } from "#features/drive/drive-row"
import { QueryStatus } from "#components/query-status"
import { Api } from "#lib/api"

function ServingBadge(props: { readonly artifact: ArtifactInfo }) {
  const updating = Boolean(props.artifact.pendingDeploymentId)
  if (!updating && props.artifact.url) return null
  return (
    <View className="h-6 flex-row items-center gap-1 rounded-full bg-secondary px-2">
      {updating ? (
        <ActivityIndicator size="small" className="scale-75" />
      ) : (
        <Icon as={IconLinkOff} className="size-3.5 text-secondary-foreground" />
      )}
      <Text className="text-xs font-medium text-secondary-foreground">{updating ? "Updating" : "Not served"}</Text>
    </View>
  )
}

function RenameForm(props: { readonly artifact: ArtifactInfo }) {
  const menu = useMenuSheet()
  const update = useMutation(Api.query.artifact.update.mutationOptions())
  const [title, setTitle] = useState(props.artifact.title)
  const [name, setName] = useState(props.artifact.name ?? "")
  const [problem, setProblem] = useState<{ readonly field: "title" | "name"; readonly message: string }>()
  const artifact = props.artifact
  const domain = Artifacts.host(artifact.url)?.split(".").slice(1).join(".")
  const save = () => {
    const nextTitle = title.trim()
    const nextName = name.trim().toLowerCase()
    const changes = {
      ...(nextTitle === artifact.title ? {} : { title: nextTitle }),
      ...(nextName === (artifact.name ?? "") ? {} : { name: nextName }),
    }
    if (Object.keys(changes).length === 0) return menu.close()
    update.mutate(
      { id: artifact.id, ...changes },
      {
        onSuccess: menu.close,
        onError: (error) => setProblem({ field: "name" in changes ? "name" : "title", message: ErrorText.of(error) }),
      },
    )
  }
  return (
    <View className="gap-4 px-5">
      <View className="gap-1">
        <Text role="heading" aria-level={2} className="text-base font-semibold">
          Rename artifact
        </Text>
        <Text className="text-sm text-muted-foreground">Changing the link stops the old one at once.</Text>
      </View>
      <View className="gap-1.5">
        <Text className="text-sm font-medium">Title</Text>
        <Input
          value={title}
          aria-label="Title"
          autoComplete="off"
          invalid={problem?.field === "title"}
          onChangeText={(next) => {
            setTitle(next)
            setProblem(undefined)
          }}
        />
        {problem?.field === "title" ? <Text className="text-sm text-destructive">{problem.message}</Text> : null}
      </View>
      <View className="gap-1.5">
        <Text className="text-sm font-medium">Link</Text>
        <Input
          value={name}
          aria-label="Link"
          placeholder="pricing-calculator"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect={false}
          invalid={problem?.field === "name"}
          onChangeText={(next) => {
            setName(next)
            setProblem(undefined)
          }}
        />
        {problem?.field === "name" ? (
          <Text className="text-sm text-destructive">{problem.message}</Text>
        ) : (
          <Text className="text-sm text-muted-foreground">
            {domain ? `https://${name.trim().toLowerCase() || "name"}.${domain}. ` : ""}Lowercase letters, digits and
            hyphens. Unique across Ren.
          </Text>
        )}
      </View>
      <View className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={update.isPending} onPress={menu.close}>
          <Text>Cancel</Text>
        </Button>
        <Button className="flex-1" disabled={update.isPending} onPress={save}>
          {update.isPending ? <ActivityIndicator size="small" /> : null}
          <Text>Save</Text>
        </Button>
      </View>
    </View>
  )
}

const byTitle = (a: ArtifactInfo, b: ArtifactInfo) =>
  a.title.localeCompare(b.title) || a.createdAt.localeCompare(b.createdAt)

function ArtifactRow(props: {
  readonly artifact: ArtifactInfo
  readonly spaceName: string | undefined
  readonly onMenu: () => void
}) {
  const url = props.artifact.url
  return (
    <DriveRow
      media={<Icon as={WindowIcon} className="size-5 text-muted-foreground" />}
      title={props.artifact.title}
      badge={<ServingBadge artifact={props.artifact} />}
      subtitle={[Artifacts.host(url) ?? "No link", ...(props.spaceName ? [props.spaceName] : [])].join(" · ")}
      onPress={() => (url ? void openBrowserAsync(url) : props.onMenu())}
      onMenu={props.onMenu}
    />
  )
}

function ArtifactMenu(props: {
  readonly artifact: ArtifactInfo | undefined
  readonly open: boolean
  readonly onClose: () => void
}) {
  const archive = useMutation(Api.query.artifact.archive.mutationOptions())
  const artifact = props.artifact
  const url = artifact?.url ?? null
  return (
    <MenuSheet
      key={artifact?.id}
      open={props.open}
      title={artifact?.title ?? ""}
      items={
        artifact
          ? [
              ...(url
                ? [
                    { label: "Open", icon: ArrowTopRightOnSquareIcon, onPress: () => openBrowserAsync(url) },
                    { label: "Copy link", icon: LinkIcon, onPress: () => setStringAsync(url) },
                  ]
                : []),
              { label: "Rename…", icon: PencilSquareIcon, panel: <RenameForm artifact={artifact} /> },
              {
                label: "Archive",
                icon: ArchiveBoxIcon,
                confirm: {
                  title: `Archive “${artifact.title}”?`,
                  description:
                    "Its link stops working for everyone who has it, and it leaves Artifacts. Ren keeps its source and data.",
                  action: "Archive",
                },
                onPress: () => archive.mutateAsync({ id: artifact.id }),
              },
            ]
          : []
      }
      onClose={props.onClose}
    />
  )
}

export default function DriveArtifacts() {
  const params = useLocalSearchParams<{ space?: string }>()
  const space = params.space || undefined
  const artifacts = useQuery(Artifacts.allOptions(Api.client, space))
  const spaces = useQuery(Api.query.space.list.queryOptions({ page: 1, pageSize: 100 })).data?.items ?? []
  const [menu, setMenu] = useState<{ readonly artifact: ArtifactInfo; readonly open: boolean }>()
  const [pulling, setPulling] = useState(false)

  const refresh = async () => {
    setPulling(true)
    await artifacts.refetch()
    setPulling(false)
  }

  return (
    <View className="flex-1 bg-background">
      <QueryStatus
        result={artifacts}
        offline="You’re offline. Your artifacts load when you reconnect."
        failure="Could not load the artifacts"
        onRetry={() => void artifacts.refetch()}
      />
      {artifacts.data ? (
        <LegendList
          data={artifacts.data.toSorted(byTitle)}
          keyExtractor={(artifact) => artifact.id}
          renderItem={(item) => (
            <ArtifactRow
              artifact={item.item}
              spaceName={space ? undefined : (spaces.find((each) => each.id === item.item.spaceId)?.name ?? "Space")}
              onMenu={() => setMenu({ artifact: item.item, open: true })}
            />
          )}
          estimatedItemSize={64}
          recycleItems
          contentContainerClassName="pb-28"
          refreshing={pulling}
          onRefresh={() => void refresh()}
          ListEmptyComponent={
            <View className="items-center gap-2 p-6">
              <Icon as={WindowIcon} className="size-6 text-muted-foreground" />
              <Text className="text-center font-medium">No artifacts yet</Text>
              <Text className="text-center text-sm text-muted-foreground">
                Sites and apps Ren publishes show up here, each at a link anyone can open.
              </Text>
            </View>
          }
        />
      ) : null}
      <ArtifactMenu
        artifact={menu?.artifact}
        open={menu?.open === true}
        onClose={() => setMenu((current) => current && { ...current, open: false })}
      />
    </View>
  )
}
