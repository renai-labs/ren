export * as Breadcrumbs from "./breadcrumbs.js"

import { useRender } from "@base-ui/react/use-render"
import type { ReactElement, ReactNode } from "react"
import { Icon } from "./icon.js"

export function Root(props: { children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumbs" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-sm text-text-secondary">{props.children}</ol>
    </nav>
  )
}

export function Link(props: { render: ReactElement; children: ReactNode }) {
  const link = useRender({
    defaultTagName: "a",
    render: props.render,
    props: {
      className:
        "flex min-w-0 items-center rounded-control font-medium text-text-primary transition-standard hover:text-text-secondary active:scale-98",
      children: <span className="truncate">{props.children}</span>,
    },
  })
  return (
    <li className="flex shrink-0 items-center gap-2">
      {link}
      <Icon glyph="ChevronRight" />
    </li>
  )
}

export function Item(props: { children: ReactNode }) {
  return (
    <li className="flex shrink-0 items-center gap-2">
      <span className="flex min-w-0 items-center">
        <span className="truncate">{props.children}</span>
      </span>
      <Icon glyph="ChevronRight" />
    </li>
  )
}

export function Page(props: { children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span aria-current="page" className="flex min-w-0 items-center font-medium text-text-primary">
        <span className="truncate">{props.children}</span>
      </span>
    </li>
  )
}
