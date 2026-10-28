export * as Page from "./page.js"

import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "./empty.js"
import { Icon } from "./icon.js"
import type { Glyph } from "./icon.js"
import { Skeleton } from "./skeleton.js"
import { TableCell, TableRow } from "./table.js"

export type Width = "column" | "full"

const frameVariants = cva("relative flex w-full min-w-0 flex-col tabular-nums", {
  variants: {
    width: {
      column: "mx-auto max-w-content gap-6 px-4 pt-22 pb-12 sm:px-6",
      full: "min-h-full flex-1 gap-4 px-4 pt-12 pb-3 md:px-8 md:pt-8",
    },
  },
  defaultVariants: { width: "column" },
})

export type RootProps = {
  title: ReactNode
  description?: ReactNode
  back?: ReactNode
  media?: ReactNode
  menu?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  width?: Width
  footer?: ReactNode
  children: ReactNode
}

export function Root(props: RootProps) {
  const full = props.width === "full"
  return (
    <div data-slot="page" className={frameVariants({ width: props.width })}>
      {props.back ? <div className="flex h-5 min-w-0 items-center">{props.back}</div> : null}
      <Heading {...props} trailing={full ? props.actions : undefined} />
      {full ? null : <Toolbar leading={props.leading} actions={props.actions} />}
      <div
        data-slot="page-body"
        className={composeClasses("flex min-w-0 flex-col gap-8", full && "min-h-0 flex-1 gap-4")}
      >
        {props.children}
      </div>
      {props.footer ? (
        <footer data-slot="page-footer" className="flex min-h-8 items-center justify-between gap-4">
          {props.footer}
        </footer>
      ) : null}
    </div>
  )
}

function Heading(props: RootProps & { trailing: ReactNode }) {
  return (
    <header className="flex min-h-7 min-w-0 items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {props.media ? <div className="flex shrink-0">{props.media}</div> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-title font-medium tracking-tight">{props.title}</h1>
          {props.description ? <p className="text-sm text-muted-foreground">{props.description}</p> : null}
        </div>
      </div>
      {props.menu || props.trailing ? (
        <div className="flex h-7 shrink-0 items-center gap-1">
          {props.menu}
          {props.trailing}
        </div>
      ) : null}
    </header>
  )
}

export function Toolbar(props: { leading?: ReactNode; actions?: ReactNode }) {
  if (!props.leading && !props.actions) return null
  return (
    <div
      data-slot="page-toolbar"
      className="flex min-h-8 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">{props.leading}</div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">{props.actions}</div>
    </div>
  )
}

export function Section(props: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  frame?: "none" | "divided"
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {props.title || props.actions ? (
        <div className="flex min-h-5 items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {props.title ? <h2 className="text-sm font-medium">{props.title}</h2> : null}
            {props.description ? <p className="text-xs text-muted-foreground">{props.description}</p> : null}
          </div>
          {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
        </div>
      ) : null}
      {props.frame === "divided" ? (
        <div
          data-slot="page-section-frame"
          className="relative flex min-w-0 flex-col divide-y rounded-xl border bg-card *:min-h-14 *:px-4 *:py-3"
        >
          {props.children}
        </div>
      ) : (
        props.children
      )}
    </section>
  )
}

export function Record(props: { banner: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div data-slot="page-record" className="flex min-h-0 w-full flex-1 flex-col tabular-nums">
      <header className="mx-4 flex h-11.5 shrink-0 items-center gap-2 border-b pl-10 text-sm md:mx-8 md:pl-0">
        {props.banner}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-8 px-4 lg:flex-row lg:pr-8 lg:pl-2">
        <div
          data-slot="page-record-body"
          className="mx-auto flex w-full max-w-content min-w-0 flex-col gap-6 pt-12 pb-16"
        >
          {props.children}
        </div>
        {props.aside ? (
          <div
            data-slot="page-aside"
            className="flex w-full shrink-0 flex-col gap-6 border-t pt-6 pb-16 lg:w-70 lg:border-t-0 lg:pt-12"
          >
            {props.aside}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Pending(
  props: Omit<RootProps, "children" | "title"> & {
    title?: ReactNode
    toolbar?: "row"
    body?: "rows" | "cards" | "settings"
    columns?: 2 | 3
  },
) {
  return (
    <Root
      {...props}
      title={props.title ?? <Skeleton className="h-5 w-40" />}
      {...(props.toolbar === "row" && { actions: <Skeleton className="h-8 w-48" /> })}
    >
      <output className="sr-only">Loading</output>
      <Skeletons body={props.body ?? "rows"} columns={props.columns} />
    </Root>
  )
}

export function RecordPending() {
  return (
    <Record
      banner={<Skeleton className="h-4 w-40" />}
      aside={
        <div aria-hidden className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      }
    >
      <output className="sr-only">Loading</output>
      <Skeleton className="h-9 w-2/3" />
      <Skeletons body="rows" />
    </Record>
  )
}

export function Skeletons(props: { body: "rows" | "cards" | "settings"; columns?: 2 | 3 | undefined }) {
  if (props.body === "cards")
    return (
      <div
        aria-hidden
        className={composeClasses("grid grid-cols-1 gap-4 sm:grid-cols-2", props.columns === 3 && "lg:grid-cols-3")}
      >
        {Array.from({ length: props.columns === 3 ? 6 : 4 }, (_, index) => (
          <Skeleton key={index} className="h-50 w-full rounded-xl" />
        ))}
      </div>
    )
  if (props.body === "settings")
    return (
      <div aria-hidden className="flex flex-col gap-8">
        {[3, 2].map((rows) => (
          <div key={rows} className="flex flex-col divide-y rounded-xl border bg-card">
            {Array.from({ length: rows }, (_, index) => (
              <div key={index} className="flex min-h-14 items-center justify-between gap-6 px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-40" />
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  )
}

export function TableCard(props: { children: ReactNode }) {
  return (
    <div
      data-slot="page-table-card"
      className="rounded-xl border bg-card p-2 tabular-nums [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3 [&_th]:font-normal [&_th]:text-muted-foreground [&_thead_tr]:border-0 [&_tr]:border-0"
    >
      {props.children}
    </div>
  )
}

export type TableStateProps = {
  state: "loading" | "failed" | "empty" | "ready"
  columns: number
  failureMessage: string
  emptyMessage: ReactNode
  emptyGlyph?: Glyph
  rows?: number
}

export function TableState(props: TableStateProps) {
  if (props.state === "ready") return null
  if (props.state === "loading")
    return Array.from({ length: props.rows ?? 3 }, (_, index) => (
      <TableRow key={index} aria-hidden={index > 0} className="hover:bg-transparent">
        <TableCell colSpan={props.columns}>
          {index === 0 ? <output className="sr-only">Loading</output> : null}
          <Skeleton aria-hidden className="h-5 w-full" />
        </TableCell>
      </TableRow>
    ))
  const glyph = props.state === "failed" ? "AlertCircle" : props.emptyGlyph
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={props.columns} className="whitespace-normal">
        <Empty {...(props.state === "failed" && { role: "alert" })} className="p-4">
          <EmptyHeader>
            {glyph ? (
              <EmptyMedia variant="icon">
                <Icon glyph={glyph} />
              </EmptyMedia>
            ) : null}
            <EmptyDescription>{props.state === "failed" ? props.failureMessage : props.emptyMessage}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TableCell>
    </TableRow>
  )
}
