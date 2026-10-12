import type { ReactNode } from "react"
import { Icon } from "../components/icon.js"
import { Text } from "../components/text.js"
import { composeClasses } from "./compose-classes.js"

export type CardBodyProps = {
  layout: "tile" | "row" | "feature"
  interaction: "none" | "link" | "button" | "selection"
  media?: ReactNode
  mediaPlacement?: "stacked" | "inline"
  title: ReactNode
  description?: ReactNode
  metadata?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  actionPlacement?: "corner" | "footer"
  footer?: ReactNode
  selected?: boolean
  children?: ReactNode
}

export function CardBody(props: CardBodyProps) {
  return (
    <>
      {props.layout === "row" ? <RowBody {...props} /> : <TileBody {...props} />}
      {props.footer === undefined ? null : (
        <span className="flex min-w-0 items-center gap-2 border-t border-border-primary pt-3">{props.footer}</span>
      )}
    </>
  )
}

function RowBody(props: CardBodyProps) {
  return (
    <>
      {props.media === undefined ? null : <span className="flex shrink-0 items-center">{props.media}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <Text purpose="label" truncation="single-line" element="span">
            {props.title}
          </Text>
          {props.badges}
        </span>
        {props.description === undefined ? null : (
          <Text purpose="caption" truncation="single-line" element="span">
            {props.description}
          </Text>
        )}
      </span>
      {props.metadata === undefined ? null : (
        <span className="flex shrink-0 items-center gap-2 text-xs text-text-secondary">{props.metadata}</span>
      )}
    </>
  )
}

function TileBody(props: CardBodyProps) {
  return (
    <>
      {props.mediaPlacement === "inline" ? <InlineHeading {...props} /> : <StackedHeading {...props} />}
      {props.children}
      {props.metadata === undefined ? null : (
        <span className="mt-auto flex min-w-0 flex-wrap items-center gap-3 text-xs text-text-secondary">
          {props.metadata}
        </span>
      )}
    </>
  )
}

function InlineHeading(props: CardBodyProps) {
  return (
    <span className="flex items-start gap-3">
      {props.media === undefined ? null : (
        <span className="flex h-lh shrink-0 items-center text-sm">{props.media}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <Text purpose="label" truncation="single-line" element="span">
          {props.title}
        </Text>
        {props.description === undefined ? null : (
          <Text purpose="caption" truncation="single-line" element="span">
            {props.description}
          </Text>
        )}
      </span>
      <Corner {...props} />
    </span>
  )
}

function StackedHeading(props: CardBodyProps) {
  const topRow =
    props.media !== undefined ||
    props.badges !== undefined ||
    props.interaction === "link" ||
    (props.interaction === "selection" && props.selected === true)
  return (
    <>
      {topRow ? (
        <span className="flex items-start justify-between gap-2">
          {props.media === undefined ? <span /> : <span className="flex shrink-0 items-center">{props.media}</span>}
          <Corner {...props} />
        </span>
      ) : null}
      <span
        className={composeClasses(
          "flex min-w-0 flex-col gap-1",
          !topRow && props.actions !== undefined && props.actionPlacement !== "footer" && "pr-8",
        )}
      >
        <Text purpose="label" truncation="single-line" element="span">
          {props.title}
        </Text>
        {props.description === undefined ? null : (
          <Text purpose="caption" truncation="two-lines" element="span">
            {props.description}
          </Text>
        )}
      </span>
    </>
  )
}

function Corner(props: CardBodyProps) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      {props.badges}
      {props.interaction === "link" ? (
        <span className="flex opacity-0 transition-standard group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
          <Icon glyph="ArrowRight" tone="secondary" />
        </span>
      ) : null}
      {props.interaction === "selection" && props.selected === true ? <Icon glyph="Check" tone="primary" /> : null}
    </span>
  )
}
