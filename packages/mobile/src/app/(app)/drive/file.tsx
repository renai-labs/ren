import { ApiError } from "@ren/client"
import { DriveQuery } from "@ren/client/react"
import { Drive } from "@ren/schema/drive"
import { Bytes } from "@ren/util/bytes"
import { DocumentKind } from "@ren/util/document-kind"
import { ErrorText } from "@ren/util/error-text"
import { FileName } from "@ren/util/file-name"
import IconX from "@tabler/icons-react-native/IconX"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { ActivityIndicator, Alert, Image, ScrollView, View } from "react-native"
import ArrowDownTrayIcon from "react-native-heroicons/mini/ArrowDownTrayIcon"
import { Button } from "#components/button"
import { FileIcon } from "#components/file-icon"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { Api } from "#lib/api"
import { DriveFiles } from "#lib/drive-files"

interface Shown {
  readonly target: DriveFiles.Target
  readonly name: string
  readonly mime: string
}

const viewOf = (name: string, mime: string) => {
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "picture"
  return DocumentKind.of({ name, mime }) || mime.startsWith("video/") || mime.startsWith("audio/")
    ? "saved"
    : "contents"
}

function Problem(props: {
  readonly error: unknown
  readonly path: string
  readonly title: string
  readonly onRetry: () => void
}) {
  const missing = ApiError.status(props.error) === 404
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      <Text className="text-center font-medium">{missing ? `No file at ${props.path}` : props.title}</Text>
      <Text className="text-center text-sm text-muted-foreground">
        {missing
          ? "It may have been moved or deleted."
          : ErrorText.of(props.error, "Check your connection and try again.")}
      </Text>
      {missing ? null : (
        <Button variant="outline" onPress={props.onRetry}>
          <Text>Try again</Text>
        </Button>
      )}
    </View>
  )
}

function Pending() {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator />
    </View>
  )
}

function Picture(props: Shown) {
  const link = useQuery(DriveQuery.link(Api.query, { ...props.target, disposition: "inline" }))
  if (link.error)
    return (
      <Problem
        error={link.error}
        path={props.target.path}
        title="Could not open the file"
        onRetry={() => void link.refetch()}
      />
    )
  if (!link.data) return <Pending />
  return (
    <ScrollView
      className="flex-1 bg-muted/40"
      contentContainerClassName="flex-1"
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Image source={{ uri: link.data.url }} resizeMode="contain" className="flex-1" alt={props.name} />
    </ScrollView>
  )
}

function Saved(props: Shown) {
  const saved = useQuery(DriveFiles.savedOptions(props.target))
  const share = () =>
    void DriveFiles.share(props.target).then(undefined, (error: unknown) =>
      Alert.alert(`Could not share ${props.name}`, ErrorText.of(error)),
    )
  if (saved.error)
    return (
      <Problem
        error={saved.error}
        path={props.target.path}
        title={`Could not download ${props.name}`}
        onRetry={() => void saved.refetch()}
      />
    )
  const file = saved.data
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      <FileIcon name={props.name} mime={props.mime} className="size-12" />
      <Text className="text-center font-medium">{props.name}</Text>
      {file ? (
        <>
          <Text className="text-sm text-muted-foreground">{Bytes.format(file.size)}</Text>
          <View className="w-full max-w-xs gap-2 pt-3">
            <Button
              onPress={() => void file.preview({ title: props.name, mimeType: props.mime }).then(undefined, share)}
            >
              <Text>Open</Text>
            </Button>
            <Button variant="outline" onPress={share}>
              <Text>Open in…</Text>
            </Button>
          </View>
        </>
      ) : (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" />
          <Text className="text-sm text-muted-foreground">Downloading…</Text>
        </View>
      )}
    </View>
  )
}

function Contents(props: Shown) {
  const read = useQuery({
    ...Api.query.files.read.queryOptions({ source: "drive", ...props.target }),
    retry: DriveQuery.retry,
  })
  if (read.error)
    return (
      <Problem
        error={read.error}
        path={props.target.path}
        title="Could not open the file"
        onRetry={() => void read.refetch()}
      />
    )
  if (!read.data) return <Pending />
  const file = read.data
  if (file.encoding !== "utf8") return <Saved {...props} />
  return (
    <ScrollView className="flex-1" contentContainerClassName="p-4 pb-safe-offset-4">
      {file.truncated ? (
        <Text className="pb-3 text-sm text-muted-foreground">{Bytes.format(file.size)}, showing the start</Text>
      ) : null}
      <Text selectable className="font-mono text-xs leading-relaxed">
        {file.content}
      </Text>
    </ScrollView>
  )
}

export default function DriveFile() {
  const params = useLocalSearchParams<{ space?: string; path: string }>()
  const router = useRouter()
  const name = FileName.base(params.path)
  const mime = Drive.typeOf(name)
  const shown = { target: { ...(params.space && { spaceId: params.space }), path: params.path }, name, mime }
  const share = useMutation({
    mutationFn: () => DriveFiles.share(shown.target),
    onError: (error) => Alert.alert(`Could not share ${name}`, ErrorText.of(error)),
  })
  const view = viewOf(name, mime)
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: name,
          headerLeft: () => (
            <Button variant="ghost" size="icon" aria-label="Close" onPress={() => router.back()}>
              <Icon as={IconX} />
            </Button>
          ),
          headerRight: () =>
            share.isPending ? (
              <View className="size-10 items-center justify-center">
                <ActivityIndicator size="small" />
              </View>
            ) : (
              <Button variant="ghost" size="icon" aria-label="Share" onPress={() => share.mutate()}>
                <Icon as={ArrowDownTrayIcon} />
              </Button>
            ),
        }}
      />
      {view === "picture" ? <Picture {...shown} /> : null}
      {view === "saved" ? <Saved {...shown} /> : null}
      {view === "contents" ? <Contents {...shown} /> : null}
    </View>
  )
}
