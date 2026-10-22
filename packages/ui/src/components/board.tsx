export * as Board from "./board.js"

import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"

export function Root(props: { label: string; children: ReactNode }) {
  return (
    <section
      data-slot="board"
      aria-label={props.label}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the board overflows horizontally, so keyboard users need to reach it to scroll
      tabIndex={0}
      className="-mx-2 flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary sm:-mx-3"
    >
      {props.children}
    </section>
  )
}

export function Column(props: { label: string; header: ReactNode; children?: ReactNode }) {
  return (
    <section
      data-slot="board-column"
      aria-label={props.label}
      className="flex w-[calc(var(--ren-container-sidebar)+var(--ren-spacing-12)+var(--ren-spacing-8)+var(--ren-spacing-3))] max-w-full shrink-0 flex-col px-3"
    >
      <header className="flex min-h-9 min-w-0 shrink-0 items-center gap-2 pr-0 pl-1">{props.header}</header>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-1 pt-1 pb-2">{props.children}</div>
    </section>
  )
}

const cardVariants = cva(
  "group/board-card flex cursor-default flex-col gap-2 rounded-control border bg-background-secondary p-3 shadow-raised transition-standard hover:bg-fill-primary",
  { variants: { selected: { true: "border-accent-primary", false: "border-border-primary" } } },
)

const actionVariants = cva("ml-auto flex items-center gap-1 transition-standard", {
  variants: {
    pinned: {
      true: "",
      false:
        "focus-within:opacity-100 has-data-popup-open:opacity-100 sm:opacity-0 sm:group-hover/board-card:opacity-100",
    },
  },
})

export type CardProps = {
  selected?: boolean
  pinnedActions?: boolean
  meta?: ReactNode
  corner?: ReactNode
  leading?: ReactNode
  title: ReactNode
  turn?: ReactNode
  chips?: ReactNode
  footer?: ReactNode
  actions?: ReactNode
}

export function Card(props: CardProps) {
  return (
    <article
      data-slot="board-card"
      data-selected={props.selected || undefined}
      className={composeClasses(cardVariants({ selected: props.selected === true }))}
    >
      <div className="flex min-h-5 min-w-0 items-center gap-2">
        {props.meta}
        {props.corner ? <span className="ml-auto flex shrink-0">{props.corner}</span> : null}
      </div>
      <div className="flex min-w-0 items-start gap-2">
        {props.leading ? <span className="-ml-1 flex min-h-5 shrink-0 items-center">{props.leading}</span> : null}
        <span className="flex min-w-0 flex-1 self-center">{props.title}</span>
      </div>
      {props.turn}
      {props.chips ? <div className="-ml-1 flex min-w-0 flex-wrap items-center gap-1">{props.chips}</div> : null}
      {props.footer || props.actions ? (
        <div className="flex min-h-6 min-w-0 items-center gap-2 text-xs text-text-secondary">
          {props.footer}
          {props.actions ? (
            <div className={composeClasses(actionVariants({ pinned: props.pinnedActions === true }))}>
              {props.actions}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
