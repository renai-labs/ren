import { createContext, use, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { FileName } from "@ren/util/file-name"
import { errorMessage } from "../lib/errors.js"
import { useDriveDownload, useDriveLink } from "../lib/use-drive-file.js"
import { ImageThumbnail } from "./image-set.js"
import { blockImage } from "./markdown-image.js"

export const DriveSpace = createContext<string | undefined>(undefined)

export function useOpenDriveFile() {
  const save = useDriveDownload(use(DriveSpace))
  return (path: string) =>
    void save(path).catch((error: unknown) =>
      toast.error(`Couldn’t open ${FileName.base(path)}`, { description: errorMessage(error) }),
    )
}

export function DriveImage(props: { path: string; alt: string }) {
  const spaceId = use(DriveSpace)
  const link = useDriveLink(spaceId)
  const shown = useQuery({ ...link(props.path, "inline"), enabled: Boolean(spaceId) })
  const name = props.alt || FileName.base(props.path)
  if (shown.data) return <ImageThumbnail src={shown.data.url} name={name} className={blockImage} />
  return (
    <span className="my-2 flex h-24 w-40 items-center justify-center rounded-md border bg-muted px-2 text-center text-sm text-muted-foreground">
      {shown.isError ? `Couldn’t load ${name}` : ""}
    </span>
  )
}

function DriveLink(props: { path: string; children: ReactNode }) {
  const open = useOpenDriveFile()
  return (
    // oxlint-disable-next-line react/forbid-elements -- a link inside text; Button would restyle it
    <button
      type="button"
      className="cursor-pointer underline decoration-muted-foreground underline-offset-3 hover:decoration-foreground"
      onClick={() => open(props.path)}
    >
      {props.children}
    </button>
  )
}

export const driveFile = (path: string, text: ReactNode, options: { image: boolean }) =>
  options.image ? (
    <DriveImage path={path} alt={typeof text === "string" ? text : ""} />
  ) : (
    <DriveLink path={path}>{text}</DriveLink>
  )
