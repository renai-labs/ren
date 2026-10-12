import { cva } from "class-variance-authority"
import type { ReactNode, SyntheticEvent } from "react"
import { composeClasses } from "../lib/compose-classes.js"

type MediaFrame = "bordered" | "plain" | "viewer"

const mediaVariants = cva("block transition-standard", {
  variants: {
    widescreen: { true: "aspect-16/9", false: "" },
    frame: {
      bordered: "w-full rounded-container border border-border-primary bg-background-secondary",
      plain: "size-full",
      viewer: "max-h-full max-w-full rounded-control",
    },
    fit: { contain: "object-contain", cover: "object-cover" },
    revealed: { true: "opacity-100", false: "opacity-0" },
  },
})

const sandboxedEmbedClasses = "size-full min-h-0 flex-1 border-0 bg-background-primary"

type MediaBaseProps = {
  source: string
  description: string
  frame?: MediaFrame
  fit?: "contain" | "cover"
  loading?: "lazy" | "eager"
  revealed?: boolean
  poster?: string
  caption?: ReactNode
  onLoad?: (event: SyntheticEvent) => void
  onError?: (event: SyntheticEvent) => void
}

export type MediaProps =
  | (MediaBaseProps & { kind: "image" | "video"; isolation?: never })
  | (MediaBaseProps & { kind: "embed"; isolation?: "standard" | "sandboxed" })

function Content(props: MediaProps) {
  const frame = props.frame ?? "bordered"
  const classes = composeClasses(
    mediaVariants({
      widescreen: props.kind !== "image",
      frame,
      fit: props.fit ?? (frame === "viewer" ? "contain" : "cover"),
      revealed: props.revealed,
    }),
  )
  const loading = props.loading ?? "lazy"
  if (props.kind === "embed" && props.isolation === "sandboxed") {
    return (
      <iframe
        data-slot="media"
        src={props.source}
        title={props.description}
        loading={loading}
        onLoad={props.onLoad}
        onError={props.onError}
        // oxlint-disable-next-line react/iframe-missing-sandbox -- only cross-origin viewers such as Google Docs go here; they need scripts and their own origin, and the sandbox still drops the rest
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        className={sandboxedEmbedClasses}
      />
    )
  }
  if (props.kind === "embed") {
    return (
      // oxlint-disable-next-line react/iframe-missing-sandbox -- standard embeds are trusted players such as YouTube, which need fullscreen and autoplay
      <iframe
        data-slot="media"
        src={props.source}
        title={props.description}
        loading={loading}
        onLoad={props.onLoad}
        onError={props.onError}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className={classes}
      />
    )
  }
  if (props.kind === "video") {
    return (
      // oxlint-disable-next-line jsx-a11y/media-has-caption -- sources carry no caption files; the description labels the video
      <video
        data-slot="media"
        src={props.source}
        poster={props.poster}
        controls
        playsInline
        preload="metadata"
        aria-label={props.description}
        onLoadedData={props.onLoad}
        onError={props.onError}
        className={classes}
      />
    )
  }
  return (
    <img
      data-slot="media"
      src={props.source}
      alt={props.description}
      loading={loading}
      onLoad={props.onLoad}
      onError={props.onError}
      className={classes}
    />
  )
}

export function Media(props: MediaProps) {
  if (!props.caption) return <Content {...props} />
  return (
    <figure className="flex flex-col gap-2">
      <Content {...props} />
      <figcaption className="text-xs text-text-secondary">{props.caption}</figcaption>
    </figure>
  )
}
