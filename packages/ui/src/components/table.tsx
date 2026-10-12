export * as Table from "./table.js"

import { cva } from "class-variance-authority"
import { createContext, use } from "react"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Icon } from "./icon.js"
import { LoadingMessage } from "./loading-message.js"
import { RowActionsMenu } from "./row-actions-menu.js"
import { StateMessage } from "./state-message.js"

export type TableDensity = "compact" | "regular"
export type TableState = "ready" | "loading" | "failed" | "empty"
export type TableSortDirection = "ascending" | "descending"
export type TableColumnAlignment = "start" | "end"
export type TableColumnWidth = "fill" | "third" | "quarter" | "narrow" | "small" | "medium" | "large"
export type TableColumnVisibility = "always" | "wide-screens"

const Context = createContext<{ density: TableDensity; state: TableState }>({ density: "regular", state: "ready" })

const frameVariants = cva("min-w-0 overflow-x-auto overscroll-x-contain", {
  variants: {
    frame: { card: "rounded-container border border-border-primary bg-background-secondary p-2", plain: "" },
  },
})

const cellVariants = cva("truncate align-middle text-sm text-text-primary", {
  variants: {
    density: { compact: "px-3 py-2", regular: "px-4 py-3" },
    alignment: { start: "text-start", end: "text-end" },
    visibility: { always: "", "wide-screens": "hidden md:table-cell" },
  },
})

const headerCellVariants = cva("h-10 font-regular text-text-secondary", {
  variants: {
    width: {
      fill: "",
      third: "w-1/3",
      quarter: "w-1/4",
      narrow: "w-16",
      small: "w-28",
      medium: "w-36",
      large: "w-48",
    },
  },
})

export function Root(props: {
  density?: TableDensity
  frame?: "card" | "plain"
  state?: TableState
  caption?: string
  reservedRows?: number
  emptyMessage?: ReactNode
  emptyDescription?: ReactNode
  emptyIcon?: ReactNode
  failureMessage?: ReactNode
  onRetry?: () => void
  children: ReactNode
}) {
  const density = props.density ?? "regular"
  const state = props.state ?? "ready"
  if (state === "empty") {
    return (
      <StateMessage
        state="empty"
        icon={props.emptyIcon}
        title={props.emptyMessage ?? "Nothing here yet."}
        description={props.emptyDescription}
      />
    )
  }
  return (
    <div
      data-slot="table"
      className={composeClasses(frameVariants({ frame: props.frame ?? "card" }))}
      style={
        props.reservedRows
          ? {
              minHeight: `calc(var(--ren-spacing-1) * ${(density === "compact" ? 10 : 12) * (props.reservedRows + 1) + 4})`,
            }
          : undefined
      }
    >
      <table className="w-full table-fixed border-collapse">
        {props.caption ? <caption className="sr-only">{props.caption}</caption> : null}
        <Context value={{ density, state }}>{props.children}</Context>
      </table>
      {state === "loading" ? <LoadingMessage /> : null}
      {state === "failed" ? (
        <StateMessage
          state="failed"
          title={props.failureMessage ?? "Couldn’t load this list."}
          onRetry={props.onRetry}
        />
      ) : null}
    </div>
  )
}

export function Header(props: { children: ReactNode }) {
  return (
    <thead>
      <tr>{props.children}</tr>
    </thead>
  )
}

type ColumnProps = {
  alignment?: TableColumnAlignment
  width?: TableColumnWidth
  visibility?: TableColumnVisibility
  children: ReactNode
}

function headerCellClasses(density: TableDensity, props: ColumnProps) {
  return composeClasses(
    cellVariants({ density, alignment: props.alignment ?? "start", visibility: props.visibility ?? "always" }),
    headerCellVariants({ width: props.width ?? "fill" }),
  )
}

export function HeaderCell(props: ColumnProps) {
  const context = use(Context)
  return (
    <th scope="col" className={headerCellClasses(context.density, props)}>
      {props.children}
    </th>
  )
}

export function SortableHeaderCell(
  props: ColumnProps & {
    direction?: TableSortDirection
    onSortChange: (direction: TableSortDirection) => void
  },
) {
  const context = use(Context)
  return (
    <th scope="col" aria-sort={props.direction} className={headerCellClasses(context.density, props)}>
      <button
        type="button"
        onClick={() => props.onSortChange(props.direction === "ascending" ? "descending" : "ascending")}
        className="-ml-2 inline-flex h-7 items-center gap-2 rounded-control px-2 text-sm text-text-secondary transition-standard hover:bg-fill-primary hover:text-text-primary"
      >
        {props.children}
        {props.direction === undefined ? null : (
          <Icon glyph={props.direction === "ascending" ? "ArrowUp" : "ArrowDown"} size="extra-small" />
        )}
      </button>
    </th>
  )
}

export function RowActionsHeaderCell() {
  return <th className="w-12" />
}

export function Body(props: { children: ReactNode }) {
  const context = use(Context)
  if (context.state !== "ready") return null
  return <tbody>{props.children}</tbody>
}

export function Row(props: { onActivate?: () => void; children: ReactNode }) {
  const onActivate = props.onActivate
  return (
    <tr
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={
        onActivate
          ? (event) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
              event.preventDefault()
              onActivate()
            }
          : undefined
      }
      className={composeClasses(
        "group/row transition-standard hover:bg-fill-primary [&>td:first-child]:rounded-l-control [&>td:last-child]:rounded-r-control",
        onActivate && "cursor-pointer",
      )}
    >
      {props.children}
    </tr>
  )
}

export function Cell(props: Omit<ColumnProps, "width">) {
  const context = use(Context)
  return (
    <td
      title={typeof props.children === "string" ? props.children : undefined}
      className={composeClasses(
        cellVariants({
          density: context.density,
          alignment: props.alignment ?? "start",
          visibility: props.visibility ?? "always",
        }),
      )}
    >
      {props.children}
    </td>
  )
}

export function RowActions(props: { label: string; children?: ReactNode }) {
  return (
    <td className="w-12 pr-3 text-end" onClick={(event) => event.stopPropagation()}>
      {props.children ? <RowActionsMenu label={props.label}>{props.children}</RowActionsMenu> : null}
    </td>
  )
}
