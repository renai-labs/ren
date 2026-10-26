export * as List from "./list.js"

import { Collapsible } from "@base-ui/react/collapsible"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { listChrome, listLayout } from "../lib/list-chrome.js"
import { ListStatus } from "../lib/list-status.js"
import type { ListFrame } from "../lib/list-chrome.js"
import type { ListStatusProps } from "../lib/list-status.js"
import { IconButton } from "./icon-button.js"
import { Icon } from "./icon.js"
import { Text } from "./text.js"

export { Item } from "../lib/list-item.js"
export type { ItemProps } from "../lib/list-item.js"
export { DisclosureItem } from "../lib/list-disclosure.js"
export type { DisclosureItemProps } from "../lib/list-disclosure.js"
export { TranscriptDisclosure, TranscriptItem } from "../lib/list-transcript.js"
export type { TranscriptDisclosureProps, TranscriptItemProps } from "../lib/list-transcript.js"
export { Virtual } from "../lib/list-virtual.js"
export type { VirtualProps } from "../lib/list-virtual.js"
export type { ListFrame, ListState } from "../lib/list-chrome.js"

export type RootProps = ListStatusProps & {
  frame?: ListFrame
  height?: "content" | "limited"
  label?: string | undefined
  children?: ReactNode
}

export function Root(props: RootProps) {
  const ready = (props.state ?? "ready") === "ready"
  return (
    <div
      data-slot="list"
      role={ready ? "list" : undefined}
      aria-label={props.label}
      className={composeClasses(
        listChrome({ frame: props.frame }),
        listLayout({ frame: props.frame, height: props.height }),
      )}
    >
      {ready ? props.children : <ListStatus {...props} />}
    </div>
  )
}

export type SectionProps = {
  title: ReactNode
  appearance?: "plain" | "eyebrow"
  actions?: ReactNode
  children?: ReactNode
}

export function Section(props: SectionProps) {
  const eyebrow = props.appearance === "eyebrow"
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <header
        className={composeClasses(
          "flex items-center justify-between gap-3 px-2",
          eyebrow && !props.actions ? "pt-2" : "min-h-8",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {eyebrow ? (
            <span className="truncate text-2xs font-reading-semibold text-text-secondary uppercase">{props.title}</span>
          ) : (
            <Text purpose="label" element="span" truncation="single-line">
              {props.title}
            </Text>
          )}
        </span>
        {props.actions ? <span className="flex shrink-0 items-center gap-1">{props.actions}</span> : null}
      </header>
      {props.children}
    </section>
  )
}

export type GroupProps = {
  title: ReactNode
  label: string
  leading?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

export function Group(props: GroupProps) {
  return (
    <Collapsible.Root
      open={props.open}
      defaultOpen={props.defaultOpen ?? true}
      onOpenChange={(open) => props.onOpenChange?.(open)}
      render={<section aria-label={props.label} />}
      className="flex min-w-0 flex-col"
    >
      <header className="flex h-9 min-w-0 items-center gap-2 rounded-control bg-fill-primary pr-2 pl-1">
        <Collapsible.Trigger
          render={(trigger, state) => (
            <IconButton {...trigger} size="compact" label={`${state.open ? "Collapse" : "Expand"} ${props.label}`}>
              <Icon glyph={state.open ? "ChevronDown" : "ChevronRight"} />
            </IconButton>
          )}
        />
        {props.leading}
        <Text purpose="label" element="h2" truncation="single-line" title={props.label}>
          {props.title}
        </Text>
        {props.meta}
        {props.actions === undefined ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1">{props.actions}</span>
        )}
      </header>
      <Collapsible.Panel
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the rows are divs with role="listitem", which a <ul> cannot hold
        role="list"
        className="flex min-w-0 flex-col"
      >
        {props.children}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
