import { Drive } from "@ren/schema/drive"
import { DocumentKind } from "@ren/util/document-kind"
import { cn } from "cn"
import ArchiveBoxIcon from "react-native-heroicons/mini/ArchiveBoxIcon"
import DocumentIcon from "react-native-heroicons/mini/DocumentIcon"
import DocumentTextIcon from "react-native-heroicons/mini/DocumentTextIcon"
import MusicalNoteIcon from "react-native-heroicons/mini/MusicalNoteIcon"
import PhotoIcon from "react-native-heroicons/mini/PhotoIcon"
import TableCellsIcon from "react-native-heroicons/mini/TableCellsIcon"
import VideoCameraIcon from "react-native-heroicons/mini/VideoCameraIcon"
import { Icon } from "#components/icon"

const archive = /zip|x-tar|gzip|x-7z|x-rar/u

const iconOf = (name: string, mime: string) => {
  if (mime.startsWith("image/")) return PhotoIcon
  if (mime.startsWith("video/")) return VideoCameraIcon
  if (mime.startsWith("audio/")) return MusicalNoteIcon
  if (DocumentKind.of({ name, mime }) === "xlsx" || mime === "text/csv") return TableCellsIcon
  if (archive.test(mime)) return ArchiveBoxIcon
  return mime.startsWith("text/") || mime === "application/json" ? DocumentTextIcon : DocumentIcon
}

function FileIcon(props: { readonly name: string; readonly mime?: string | undefined; readonly className?: string }) {
  return (
    <Icon
      as={iconOf(props.name, props.mime ?? Drive.typeOf(props.name))}
      className={cn("size-5 text-muted-foreground", props.className)}
    />
  )
}

export { FileIcon }
