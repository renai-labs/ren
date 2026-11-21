import { Composer } from "@ren/chat"
import { ApiError } from "@ren/client"
import { DriveQuery } from "@ren/client/react"
import { Drive } from "@ren/schema/drive"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Bytes } from "@ren/util/bytes"
import { FileName } from "@ren/util/file-name"
import IconX from "@tabler/icons-react-native/IconX"
import { useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { Link } from "expo-router"
import type { ComponentProps, ReactNode } from "react"
import { Image, Pressable, ScrollView, View } from "react-native"
import ArrowPathIcon from "react-native-heroicons/mini/ArrowPathIcon"
import { Button } from "#components/button"
import { FileIcon } from "#components/file-icon"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { pickerItems, UploadProgress, useUploads, type Upload } from "#components/uploads"
import { Api } from "#lib/api"

const thumbnailed = (mime: string) => mime.startsWith("image/") && mime !== "image/svg+xml"

function useAttachments(target: {
  readonly sessionId: Session.ID
  readonly spaceId: string | undefined
  readonly draft: Composer.Draft
  readonly update: (change: (draft: Composer.Draft) => Composer.Draft) => void
}) {
  const uploads = useUploads({
    space: target.spaceId,
    onDone: (upload) =>
      target.update((current) =>
        Composer.withFile(current, { path: upload.path, name: upload.name, mime: upload.mime, size: upload.size }),
      ),
  })
  const files = Composer.files(target.draft)
  const items = pickerItems((incoming) => {
    const draft = target.draft
    if (incoming.length === 0 || !target.spaceId) return
    if (files.length + uploads.uploads.length + incoming.length > Session.maxDriveFiles)
      throw new Error(`Too many files. A message can attach ${Session.maxDriveFiles} files.`)
    const messageId = draft.messageId ?? SessionMessage.ID.create()
    if (!draft.messageId) target.update((current) => Composer.withMessageID(current, messageId))
    const taken = new Set([...files, ...uploads.uploads].map((file) => file.name))
    uploads.start(
      incoming
        .filter((each) => each.size <= Drive.maxUploadBytes)
        .map((each) => {
          const name = FileName.free(each.name || "Pasted file", taken)
          taken.add(name)
          return { picked: each, path: `${Drive.uploadsOf(target.sessionId, messageId)}/${name}` }
        }),
    )
    const large = incoming.filter((each) => each.size > Drive.maxUploadBytes)
    if (large.length > 0)
      throw new Error(
        `${large.length === 1 ? `${large.at(0)?.name ?? "A file"} is too large` : "Some files are too large"}. A file can be at most ${Bytes.format(Drive.maxUploadBytes)}.`,
      )
  })
  return {
    spaceId: target.spaceId,
    files,
    uploads: uploads.uploads,
    items,
    retry: uploads.retry,
    cancel: uploads.cancel,
    remove: (path: string) => {
      target.update((current) => Composer.withoutFile(current, path))
      if (target.spaceId)
        void Api.client.files.delete({ source: "drive", spaceId: target.spaceId, path }).catch(() => undefined)
    },
  }
}

type Attachments = ReturnType<typeof useAttachments>

function useDriveLink(spaceId: string | undefined, file: SessionMessage.DriveFile) {
  const link = useQuery({
    ...DriveQuery.link(Api.query, { ...(spaceId && { spaceId }), path: file.path, disposition: "inline" }),
    enabled: Boolean(spaceId) && thumbnailed(file.mime),
  })
  return { url: link.data?.url, deleted: ApiError.status(link.error) === 404 }
}

const fileHref = (spaceId: string | undefined, path: string) =>
  ({ pathname: "/drive/file", params: { ...(spaceId && { space: spaceId }), path } }) as const

function ChipAction(props: {
  readonly label: string
  readonly icon: ComponentProps<typeof Icon>["as"]
  readonly disabled?: boolean | undefined
  readonly onPress: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 rounded-full"
      hitSlop={4}
      aria-label={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Icon as={props.icon} className="size-4 text-muted-foreground" />
    </Button>
  )
}

function Chip(props: {
  readonly name: string
  readonly mime: string
  readonly thumbnail: string | undefined
  readonly failed?: boolean
  readonly href?: ReturnType<typeof fileHref> | undefined
  readonly detail: ReactNode
  readonly children?: ReactNode
}) {
  const body = (
    <Pressable
      disabled={!props.href}
      aria-label={props.href ? `Open ${props.name}` : undefined}
      className="flex-row items-center gap-2"
    >
      <View className="size-9 items-center justify-center overflow-hidden rounded-lg bg-background">
        {props.thumbnail ? (
          <Image source={{ uri: props.thumbnail }} resizeMode="cover" className="size-full" alt={props.name} />
        ) : (
          <FileIcon name={props.name} mime={props.mime} />
        )}
      </View>
      <View className="max-w-36 gap-1">
        <Text className="text-sm" numberOfLines={1}>
          {props.name}
        </Text>
        {props.detail}
      </View>
    </Pressable>
  )
  return (
    <View
      className={cn(
        "h-12 flex-row items-center gap-1 rounded-xl py-1.5 pl-1.5",
        props.children ? "pr-0.5" : "pr-3",
        props.failed ? "bg-destructive/10" : "bg-muted dark:bg-secondary",
      )}
    >
      {props.href ? (
        <Link href={props.href} asChild>
          {body}
        </Link>
      ) : (
        body
      )}
      {props.children}
    </View>
  )
}

function DriveFileChip(props: {
  readonly spaceId: string | undefined
  readonly file: SessionMessage.DriveFile
  readonly disabled?: boolean | undefined
  readonly onRemove?: () => void
}) {
  const file = props.file
  const link = useDriveLink(props.spaceId, file)
  return (
    <Chip
      name={file.name}
      mime={file.mime}
      thumbnail={link.deleted ? undefined : link.url}
      failed={link.deleted}
      href={link.deleted ? undefined : fileHref(props.spaceId, file.path)}
      detail={
        <Text className="text-xs text-muted-foreground tabular-nums">
          {link.deleted ? "Not in the drive" : Bytes.format(file.size)}
        </Text>
      }
    >
      {props.onRemove ? (
        <ChipAction label={`Remove ${file.name}`} icon={IconX} disabled={props.disabled} onPress={props.onRemove} />
      ) : null}
    </Chip>
  )
}

function UploadChip(props: {
  readonly upload: Upload
  readonly disabled?: boolean | undefined
  readonly onRetry: () => void
  readonly onCancel: () => void
}) {
  const upload = props.upload
  return (
    <Chip
      name={upload.name}
      mime={upload.mime}
      thumbnail={thumbnailed(upload.mime) ? upload.uri : undefined}
      failed={Boolean(upload.error)}
      detail={
        upload.error ? (
          <Text className="text-xs text-destructive" numberOfLines={1}>
            {upload.error}
          </Text>
        ) : (
          <UploadProgress progress={upload.progress} className="my-1 h-1 w-20" />
        )
      }
    >
      {upload.error ? (
        <ChipAction
          label={`Retry ${upload.name}`}
          icon={ArrowPathIcon}
          disabled={props.disabled}
          onPress={props.onRetry}
        />
      ) : null}
      <ChipAction label={`Remove ${upload.name}`} icon={IconX} disabled={props.disabled} onPress={props.onCancel} />
    </Chip>
  )
}

function UploadChips(props: {
  readonly attachments: Attachments | undefined
  readonly disabled?: boolean | undefined
}) {
  const attachments = props.attachments
  if (!attachments || attachments.files.length + attachments.uploads.length === 0) return null
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className="grow-0"
      contentContainerClassName="gap-2 px-3 pt-3"
    >
      {attachments.files.map((file) => (
        <DriveFileChip
          key={file.path}
          spaceId={attachments.spaceId}
          file={file}
          disabled={props.disabled}
          onRemove={() => attachments.remove(file.path)}
        />
      ))}
      {attachments.uploads.map((upload) => (
        <UploadChip
          key={upload.id}
          upload={upload}
          disabled={props.disabled}
          onRetry={() => attachments.retry(upload)}
          onCancel={() => attachments.cancel(upload)}
        />
      ))}
    </ScrollView>
  )
}

function ImageTile(props: { readonly spaceId: string | undefined; readonly file: SessionMessage.DriveFile }) {
  const file = props.file
  const link = useDriveLink(props.spaceId, file)
  if (link.deleted) return <DriveFileChip spaceId={props.spaceId} file={file} />
  return (
    <Link href={fileHref(props.spaceId, file.path)} asChild>
      <Pressable aria-label={`Open ${file.name}`} className="size-32 overflow-hidden rounded-xl bg-muted">
        {link.url ? (
          <Image source={{ uri: link.url }} resizeMode="cover" className="size-full" alt={file.name} />
        ) : null}
      </Pressable>
    </Link>
  )
}

function DriveFileCards(props: {
  readonly spaceId: string | undefined
  readonly files: ReadonlyArray<SessionMessage.DriveFile>
  readonly className?: string
}) {
  if (props.files.length === 0) return null
  return (
    <View className={cn("flex-row flex-wrap gap-2", props.className)}>
      {props.files.map((file) =>
        thumbnailed(file.mime) ? (
          <ImageTile key={file.path} spaceId={props.spaceId} file={file} />
        ) : (
          <DriveFileChip key={file.path} spaceId={props.spaceId} file={file} />
        ),
      )}
    </View>
  )
}

export { DriveFileCards, UploadChips, useAttachments, type Attachments }
