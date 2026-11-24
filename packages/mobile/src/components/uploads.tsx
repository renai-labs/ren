import { Uploads } from "@ren/client/react"
import { Drive } from "@ren/schema/drive"
import { ErrorText } from "@ren/util/error-text"
import { FileName } from "@ren/util/file-name"
import { cn } from "cn"
import { getDocumentAsync } from "expo-document-picker"
import { File } from "expo-file-system"
import { launchImageLibraryAsync } from "expo-image-picker"
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

type Upload = Uploads.Upload<Picked>

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

const transfer: Uploads.Transfer<Picked> = (form, file, options) => DriveFiles.upload(form, new File(file.uri), options)

function useUploads(options: { readonly space: string | undefined; readonly onDone: (upload: Upload) => void }) {
  const queue = Uploads.useQueue({
    client: Api.client,
    transfer,
    describe: (error) => ErrorText.of(error, "The upload failed. Try again."),
    onDone: options.onDone,
  })
  return {
    uploads: queue.uploads,
    start: (entries: ReadonlyArray<{ readonly picked: Picked; readonly path: string; readonly error?: string }>) =>
      queue.start(
        entries.map((entry) => ({
          file: entry.picked,
          spaceId: options.space,
          path: entry.path,
          name: FileName.base(entry.path),
          mime: entry.picked.mime,
          size: entry.picked.size,
          ...(entry.error && { error: entry.error }),
        })),
      ),
    retry: queue.retry,
    cancel: queue.cancel,
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
