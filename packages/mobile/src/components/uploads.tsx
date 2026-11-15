import { Drive } from "@ren/schema/drive"
import { ErrorText } from "@ren/util/error-text"
import { FileName } from "@ren/util/file-name"
import { cn } from "cn"
import { Struct } from "effect"
import { getDocumentAsync } from "expo-document-picker"
import { File } from "expo-file-system"
import { launchImageLibraryAsync } from "expo-image-picker"
import { useState } from "react"
import { View } from "react-native"
import DocumentIcon from "react-native-heroicons/mini/DocumentIcon"
import PhotoIcon from "react-native-heroicons/mini/PhotoIcon"
import type { MenuItem } from "#components/menu-sheet"
import { Api } from "#lib/api"
import { DriveFiles } from "#lib/drive-files"

interface Picked {
  readonly uri: string
  readonly name: string
  readonly mime: string
  readonly size: number
}

interface Upload extends Picked {
  readonly id: string
  readonly path: string
  readonly progress: number
  readonly controller: AbortController
  readonly error?: string
}

const picked = (uri: string, name: string, mime: string | undefined): Picked => ({
  uri,
  name,
  mime: mime ?? Drive.typeOf(name),
  size: new File(uri).size,
})

const pickerItems = (onPick: (picked: ReadonlyArray<Picked>) => void): ReadonlyArray<MenuItem> => [
  {
    label: "Photo or video",
    icon: PhotoIcon,
    onPress: () =>
      launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, quality: 1 }).then(
        (result) =>
          result.canceled
            ? undefined
            : onPick(
                result.assets.map((asset) =>
                  picked(asset.uri, asset.fileName ?? new File(asset.uri).name, asset.mimeType),
                ),
              ),
      ),
  },
  {
    label: "File",
    icon: DocumentIcon,
    onPress: () =>
      getDocumentAsync({ multiple: true, copyToCacheDirectory: true }).then((result) =>
        result.canceled
          ? undefined
          : onPick(result.assets.map((asset) => picked(asset.uri, asset.name, asset.mimeType))),
      ),
  },
]

function useUploads(options: { readonly space: string | undefined; readonly onDone: (upload: Upload) => void }) {
  const [uploads, setUploads] = useState<ReadonlyArray<Upload>>([])
  const replace = (next: Upload) =>
    setUploads((current) => current.map((upload) => (upload.id === next.id ? next : upload)))
  const advance = (id: string, progress: number) =>
    setUploads((current) =>
      current.some((upload) => upload.id === id && upload.progress !== progress)
        ? current.map((upload) => (upload.id === id ? { ...upload, progress } : upload))
        : current,
    )
  const drop = (id: string) => setUploads((current) => current.filter((upload) => upload.id !== id))
  const send = (upload: Upload) =>
    void Api.client.drive
      .startUpload({ ...(options.space && { spaceId: options.space }), path: upload.path, size: upload.size })
      .then((form) =>
        DriveFiles.upload(form, new File(upload.uri), upload.mime, upload.controller.signal, (fraction) =>
          advance(upload.id, Math.round(fraction * 100)),
        ),
      )
      .then(
        () => {
          if (upload.controller.signal.aborted) return
          drop(upload.id)
          options.onDone(upload)
        },
        (error: unknown) => {
          if (!upload.controller.signal.aborted)
            replace({ ...upload, error: ErrorText.of(error, "The upload failed. Try again.") })
        },
      )
  return {
    uploads,
    start: (entries: ReadonlyArray<{ readonly picked: Picked; readonly path: string; readonly error?: string }>) => {
      const added = entries.map((entry): Upload => ({
        ...entry.picked,
        id: crypto.randomUUID(),
        name: FileName.base(entry.path),
        path: entry.path,
        progress: 0,
        controller: new AbortController(),
        ...(entry.error && { error: entry.error }),
      }))
      setUploads((current) => [...current, ...added])
      for (const upload of added.filter((each) => !each.error)) send(upload)
    },
    retry: (upload: Upload) => {
      const next = { ...Struct.omit(upload, ["error"]), progress: 0, controller: new AbortController() }
      replace(next)
      send(next)
    },
    cancel: (upload: Upload) => {
      upload.controller.abort()
      drop(upload.id)
    },
  }
}

function UploadProgress(props: { readonly progress: number; readonly className?: string }) {
  return (
    <View
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.progress}
      className={cn("overflow-hidden rounded-full bg-border", props.className)}
    >
      <View className="h-full rounded-full bg-primary" style={{ width: `${props.progress}%` }} />
    </View>
  )
}

export { UploadProgress, pickerItems, useUploads, type Upload }
