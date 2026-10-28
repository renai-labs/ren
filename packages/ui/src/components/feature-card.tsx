import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Card } from "./card.js"
import { Text } from "./text.js"

export type FeatureCardProps = {
  label: string
  onSelect: () => void
  title: ReactNode
  media?: ReactNode
  description?: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
  appearanceOrder?: number
}

export function FeatureCard(props: FeatureCardProps) {
  return (
    <Card
      className={composeClasses(
        "relative min-w-0 gap-0 overflow-visible rounded-container border border-border-primary bg-background-secondary py-0 text-start ring-0 transition-standard has-[>button:active]:scale-99 has-[>button:hover]:bg-fill-primary",
        props.appearanceOrder !== undefined && "animate-entrance",
      )}
      style={
        props.appearanceOrder === undefined
          ? undefined
          : { animationDelay: `${Math.min(props.appearanceOrder * 30, 240)}ms` }
      }
    >
      <button
        type="button"
        aria-label={props.label}
        onClick={props.onSelect}
        className="flex min-h-26 w-full min-w-0 flex-1 cursor-pointer flex-col gap-3 rounded-container p-4 text-start outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary focus-visible:outline-solid"
      >
        {props.media ? (
          <span className="flex items-start justify-between gap-2">
            <span className="flex shrink-0 items-center">{props.media}</span>
          </span>
        ) : null}
        <span className={composeClasses("flex min-w-0 flex-col gap-1", !props.media && props.actions && "pr-8")}>
          <Text purpose="label" truncation="single-line" element="span">
            {props.title}
          </Text>
          {props.description ? (
            <Text purpose="caption" truncation="two-lines" element="span">
              {props.description}
            </Text>
          ) : null}
        </span>
        {props.metadata ? (
          <span className="mt-auto flex min-w-0 flex-wrap items-center gap-3 text-xs text-text-secondary">
            {props.metadata}
          </span>
        ) : null}
      </button>
      {props.actions ? (
        <span className="absolute top-3 right-3 z-10 flex shrink-0 items-center gap-1">{props.actions}</span>
      ) : null}
    </Card>
  )
}
