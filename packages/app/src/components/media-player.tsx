import { useState, type SyntheticEvent } from "react"
import { IconAlertTriangle, IconDownload } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"
import { formatBytes } from "../lib/format.js"

const state: { current: HTMLMediaElement | undefined; muted: boolean } = { current: undefined, muted: false }

function MediaBody(props: {
  kind: "video" | "audio"
  name: string
  url: string | undefined
  failed: boolean
  attach: (media: HTMLMediaElement | null) => void
  onError: (event: SyntheticEvent<HTMLMediaElement>) => void
  onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => void
  onPlay: (event: SyntheticEvent<HTMLMediaElement>) => void
  onVolumeChange: (event: SyntheticEvent<HTMLMediaElement>) => void
}) {
  const video = props.kind === "video"
  if (props.failed)
    return (
      <div role="alert" className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
        <IconAlertTriangle className="size-4 shrink-0" />
        This {props.kind} can’t play in your browser
      </div>
    )
  if (!props.url) return <div className={cn("w-full bg-muted", video ? "aspect-video max-h-96" : "h-14")} />
  const events = {
    ref: props.attach,
    controls: true,
    preload: "metadata",
    onError: props.onError,
    onLoadedMetadata: props.onLoadedMetadata,
    onPlay: props.onPlay,
    onVolumeChange: props.onVolumeChange,
  } as const
  // oxlint-disable-next-line jsx-a11y/media-has-caption -- Drive files carry no caption track.
  if (!video) return <audio {...events} src={props.url} aria-label={props.name} className="w-full p-2" />
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- Drive files carry no caption track.
    <video
      {...events}
      src={`${props.url}#t=0.001`}
      playsInline
      aria-label={props.name}
      className="aspect-video max-h-96 w-full bg-black"
    />
  )
}

export function MediaPlayer(props: {
  kind: "video" | "audio"
  src: string | undefined
  name: string
  size: number
  deleted: boolean
  refresh: () => Promise<string | undefined>
  onDownload: () => void
}) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [resume, setResume] = useState<{ time: number; playing: boolean }>()
  const url = src ?? props.src
  const video = props.kind === "video"

  const fail = (event: SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget
    if (refreshed || media.error?.code === MediaError.MEDIA_ERR_DECODE) {
      setFailed(true)
      return
    }
    setRefreshed(true)
    setResume({ time: media.currentTime, playing: !media.paused })
    void props.refresh().then((next) => (next ? setSrc(next) : setFailed(true)))
  }
  const restore = (event: SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget
    const saved = resume
    setResume(undefined)
    if (!saved) return
    media.currentTime = saved.time
    if (saved.playing) void media.play().catch(() => undefined)
  }
  const attach = (media: HTMLMediaElement | null) => {
    if (media) media.muted = state.muted
  }
  const common = {
    attach,
    onError: fail,
    onLoadedMetadata: restore,
    onPlay: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (state.current && state.current !== event.currentTarget) state.current.pause()
      state.current = event.currentTarget
    },
    onVolumeChange: (event: SyntheticEvent<HTMLMediaElement>) => {
      state.muted = event.currentTarget.muted
    },
  } as const

  return (
    <div
      data-slot="media-player"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground",
        video ? "max-w-170" : "max-w-md",
      )}
    >
      {props.deleted ? null : <MediaBody kind={props.kind} name={props.name} url={url} failed={failed} {...common} />}
      <div
        className={cn("flex items-center gap-2 px-3 py-1.5 text-xs", !props.deleted && "border-t")}
        data-slot="media-caption"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{props.name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {props.deleted ? "Not in the drive" : formatBytes(props.size)}
        </span>
        {props.deleted ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Download ${props.name}`}
            onClick={props.onDownload}
          >
            <IconDownload />
          </Button>
        )}
      </div>
    </div>
  )
}
