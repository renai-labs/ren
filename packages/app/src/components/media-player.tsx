import { useRef, useState, type ComponentProps, type SyntheticEvent } from "react"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconAlertTriangle, IconDownload } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"
import { formatBytes } from "../lib/format.js"
import { useDriveFile } from "../lib/use-drive-file.js"

const shared: { playing: HTMLMediaElement | undefined; muted: boolean } = { playing: undefined, muted: false }

function MediaBody(props: {
  kind: "video" | "audio"
  url: string | undefined
  failed: boolean
  media: ComponentProps<"video"> & ComponentProps<"audio">
}) {
  const video = props.kind === "video"
  if (props.failed)
    return (
      <div role="alert" className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <IconAlertTriangle className="size-4 shrink-0" />
        This {props.kind} can’t play in your browser
      </div>
    )
  if (!props.url) return <div className={cn("w-full bg-muted", video ? "aspect-video" : "h-10 rounded-full")} />
  // oxlint-disable-next-line jsx-a11y/media-has-caption -- Drive files carry no caption track.
  if (!video) return <audio {...props.media} src={props.url} className="h-10 w-full" />
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- Drive files carry no caption track.
    <video {...props.media} src={`${props.url}#t=0.001`} playsInline className="aspect-video w-full bg-black" />
  )
}

export function MediaPlayer(props: {
  spaceId: string | undefined
  file: SessionMessage.DriveFile
  kind: "video" | "audio"
}) {
  const drive = useDriveFile(props.spaceId, props.file)
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  const resume = useRef<{ time: number; playing: boolean }>(undefined)
  const url = src ?? drive.url
  const video = props.kind === "video"
  const name = props.file.name
  const boxed = video || failed || drive.deleted
  const media = {
    ref: (element: HTMLMediaElement | null) => {
      if (element) element.muted = shared.muted
    },
    controls: true,
    preload: "metadata",
    "aria-label": name,
    onError: (event: SyntheticEvent<HTMLMediaElement>) => {
      const element = event.currentTarget
      if (resume.current || element.error?.code === MediaError.MEDIA_ERR_DECODE) {
        setFailed(true)
        return
      }
      resume.current = { time: element.currentTime, playing: !element.paused }
      void drive.refresh().then((next) => (next && next !== url ? setSrc(next) : setFailed(true)))
    },
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const saved = resume.current
      resume.current = undefined
      if (!saved) return
      event.currentTarget.currentTime = saved.time
      if (saved.playing) void event.currentTarget.play().catch(() => undefined)
    },
    onPlay: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (shared.playing !== event.currentTarget) shared.playing?.pause()
      shared.playing = event.currentTarget
    },
    onVolumeChange: (event: SyntheticEvent<HTMLMediaElement>) => {
      shared.muted = event.currentTarget.muted
    },
  } as const
  return (
    <div
      data-slot="media-player"
      className={cn(
        "flex w-full flex-col",
        boxed ? "overflow-hidden rounded-xl border bg-card text-card-foreground" : "gap-0.5",
        video ? "max-w-md" : "max-w-sm",
      )}
    >
      {drive.deleted ? null : <MediaBody kind={props.kind} url={url} failed={failed} media={media} />}
      <div
        data-slot="media-caption"
        className={cn("flex items-center gap-2 px-3 py-1.5 text-xs", boxed && !drive.deleted && "border-t")}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {drive.deleted ? "Not in the drive" : formatBytes(props.file.size)}
        </span>
        {drive.deleted ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Download ${name}`}
            onClick={drive.download}
          >
            <IconDownload />
          </Button>
        )}
      </div>
    </div>
  )
}
