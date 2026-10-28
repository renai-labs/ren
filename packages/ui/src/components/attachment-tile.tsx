export * as AttachmentTile from "./attachment-tile.js"

import { useState } from "react"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import type { Glyph } from "./icon.js"
import { Spinner } from "./spinner.js"
import { Text } from "./text.js"

type Removal = {
  onRemove?: () => void
  removeLabel?: string
  "data-testid"?: string
}

function Remove(props: { name: string; label: string | undefined; onRemove: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={props.label ?? `Remove ${props.name}`}
      className="text-muted-foreground"
      onClick={props.onRemove}
    >
      <Icon glyph="X" size="extra-small" />
    </Button>
  )
}

export function Thumbnail(
  props: Removal & {
    name: string
    image?: string | null
    glyph?: Glyph
    state?: "ready" | "resolving"
    onImageError?: (image: HTMLImageElement) => void
  },
) {
  const [loadedImage, setLoadedImage] = useState<string | null>(null)
  const resolving = props.state === "resolving"
  const image = props.image
  return (
    <div
      data-slot="attachment"
      data-presentation="thumbnail"
      data-testid={props["data-testid"]}
      title={props.name}
      className="group relative size-24 shrink-0 overflow-hidden rounded-container border border-border-primary/disabled bg-fill-primary"
    >
      {image ? (
        <img
          alt={props.name}
          src={image}
          width={96}
          height={96}
          ref={(element) => {
            if (element?.complete && element.naturalWidth === 0) props.onImageError?.(element)
          }}
          onError={(event) => props.onImageError?.(event.currentTarget)}
          onLoad={() => setLoadedImage(image)}
          className={composeClasses(
            "size-full object-cover transition-standard",
            loadedImage === image ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {image || resolving ? null : (
        <div className="flex size-full min-w-0 flex-col items-center justify-center gap-2 px-2 text-text-secondary [&_svg]:size-5">
          {props.glyph === undefined ? null : <Icon glyph={props.glyph} size="medium" />}
          <span className="w-full">
            <Text purpose="caption" truncation="single-line" element="span" alignment="center">
              {props.name}
            </Text>
          </span>
        </div>
      )}
      {resolving ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="text-text-secondary" />
        </div>
      ) : null}
      {props.onRemove === undefined ? null : (
        <span className="absolute top-2 right-2">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={props.removeLabel ?? `Remove ${props.name}`}
            className="rounded-full bg-overlay-primary text-text-inverse hover:bg-overlay-primary/disabled hover:text-text-inverse"
            onClick={props.onRemove}
          >
            <Icon glyph="X" size="extra-small" />
          </Button>
        </span>
      )}
    </div>
  )
}

export function Chip(
  props: Removal & {
    name: string
    detail?: ReactNode
    glyph?: Glyph
    state?: "ready" | "unavailable"
  },
) {
  const unavailable = props.state === "unavailable"
  return (
    <div
      data-slot="attachment"
      data-presentation="chip"
      data-state={props.state ?? "ready"}
      data-testid={props["data-testid"]}
      className={composeClasses(
        "flex max-w-70 min-w-0 items-center gap-3 rounded-control border border-border-primary px-3 py-2",
        unavailable ? "border-dashed bg-transparent" : "bg-fill-primary",
      )}
    >
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center [&_svg]:size-4">
        {props.glyph === undefined ? null : <Icon glyph={props.glyph} />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={composeClasses(
            "text-sm/xs font-medium wrap-anywhere",
            unavailable ? "text-text-secondary line-through" : "text-text-primary",
          )}
        >
          {props.name}
        </span>
        {props.detail ? (
          <Text purpose="caption" element="span">
            {props.detail}
          </Text>
        ) : null}
      </span>
      {props.onRemove === undefined ? null : (
        <Remove name={props.name} label={props.removeLabel} onRemove={props.onRemove} />
      )}
    </div>
  )
}

export function Excerpt(props: Removal & { name: string; footer?: ReactNode; children?: ReactNode }) {
  return (
    <div
      data-slot="attachment"
      data-presentation="excerpt"
      data-testid={props["data-testid"]}
      className="relative flex w-64 shrink-0 flex-col gap-2 rounded-container border border-border-primary/disabled bg-fill-primary/disabled p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <Text purpose="caption" tone="primary" weight="medium" element="span">
          {props.name}
        </Text>
        {props.onRemove === undefined ? null : (
          <Remove name={props.name} label={props.removeLabel} onRemove={props.onRemove} />
        )}
      </div>
      <div className="wrap-break-word whitespace-pre-wrap">{props.children}</div>
      {props.footer ? <div className="flex items-center justify-between gap-2">{props.footer}</div> : null}
    </div>
  )
}
