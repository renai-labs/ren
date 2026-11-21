import { Drive } from "@ren/schema/drive"
import { Bytes } from "@ren/util/bytes"
import { FileName } from "@ren/util/file-name"
import IconX from "@tabler/icons-react-native/IconX"
import { View } from "react-native"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { pickerItems, UploadProgress, useUploads, type Upload } from "#components/uploads"

const tooLarge = `It is too large. A file can be at most ${Bytes.format(Drive.maxUploadBytes)}.`

function useDriveUploads(target: {
  readonly space: string | undefined
  readonly folder: string
  readonly taken: ReadonlyArray<string>
  readonly onDone: () => void
}) {
  const uploads = useUploads({ space: target.space, onDone: target.onDone })
  const items = pickerItems((incoming) => {
    const names = new Set(target.taken)
    uploads.start(
      incoming.map((each) => {
        const large = each.size > Drive.maxUploadBytes
        const path = large ? each.name : FileName.free(`${target.folder}${each.name}`, names)
        names.add(path)
        return { picked: each, path, ...(large && { error: tooLarge }) }
      }),
    )
  })
  return { uploads: uploads.uploads, items, dismiss: uploads.cancel }
}

function DriveUploads(props: {
  readonly uploads: ReadonlyArray<Upload>
  readonly onDismiss: (upload: Upload) => void
}) {
  if (props.uploads.length === 0) return null
  return (
    <View className="gap-2 px-4 pb-2">
      {props.uploads.map((upload) => (
        <View key={upload.id} className="gap-1.5 rounded-lg bg-muted px-3 py-2">
          <View className="min-h-6 flex-row items-center gap-2">
            <Text className="flex-1 text-sm" numberOfLines={1}>
              {upload.error ? `Could not upload ${upload.name}` : `Uploading ${upload.name}`}
            </Text>
            {upload.error ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Dismiss"
                onPress={() => props.onDismiss(upload)}
              >
                <Icon as={IconX} className="size-4 text-muted-foreground" />
              </Button>
            ) : (
              <Text className="text-sm text-muted-foreground tabular-nums">{upload.progress}%</Text>
            )}
          </View>
          {upload.error ? (
            <Text className="text-sm text-destructive">{upload.error}</Text>
          ) : (
            <UploadProgress progress={upload.progress} className="h-1" />
          )}
        </View>
      ))}
    </View>
  )
}

export { DriveUploads, useDriveUploads }
