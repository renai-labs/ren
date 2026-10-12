export * as Pagination from "./pagination.js"

import { Fragment } from "react"
import type { ReactNode } from "react"
import { Icon } from "./icon.js"
import { IconButton } from "./icon-button.js"

export type RootProps = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

export function Root(props: RootProps) {
  return (
    <Frame {...props}>
      <span className="px-2 text-sm text-text-secondary tabular-nums">
        {props.page} / {props.pageCount}
      </span>
    </Frame>
  )
}

export function Numbered(props: RootProps) {
  return (
    <Frame {...props}>
      {pages(props.page, props.pageCount).map((item) => (
        <Fragment key={item.page}>
          {item.gap ? <span className="px-1 text-sm text-text-secondary">…</span> : null}
          <button
            type="button"
            aria-current={item.page === props.page ? "page" : undefined}
            onClick={() => props.onPageChange(item.page)}
            className="grid h-7 min-w-7 place-items-center rounded-control px-2 text-sm text-text-secondary tabular-nums transition-standard hover:bg-fill-primary aria-[current=page]:bg-fill-secondary aria-[current=page]:text-text-primary"
          >
            {item.page}
          </button>
        </Fragment>
      ))}
    </Frame>
  )
}

function Frame(props: RootProps & { children: ReactNode }) {
  if (props.pageCount <= 1) return null
  return (
    <nav aria-label="Pagination" data-slot="pagination" className="flex items-center justify-end gap-1">
      <IconButton label="Previous page" disabled={props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}>
        <Icon glyph="ChevronLeft" />
      </IconButton>
      {props.children}
      <IconButton
        label="Next page"
        disabled={props.page >= props.pageCount}
        onClick={() => props.onPageChange(props.page + 1)}
      >
        <Icon glyph="ChevronRight" />
      </IconButton>
    </nav>
  )
}

function pages(page: number, pageCount: number) {
  const visible =
    pageCount <= 7
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : [...new Set([1, pageCount, page - 1, page, page + 1])]
          .filter((value) => value >= 1 && value <= pageCount)
          .toSorted((a, b) => a - b)
  return visible.map((value, index) => ({ page: value, gap: value - (visible[index - 1] ?? value - 1) > 1 }))
}
