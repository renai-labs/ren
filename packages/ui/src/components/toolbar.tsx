export * as Toolbar from "./toolbar.js"

import { Toolbar } from "@base-ui/react/toolbar"
import { cva } from "class-variance-authority"
import type { ReactElement, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"

const rootVariants = cva("flex min-w-0 flex-wrap items-center", {
  variants: {
    size: { small: "min-h-7 gap-1", medium: "min-h-8 gap-2" },
    alignment: { end: "justify-end", split: "justify-between" },
  },
  defaultVariants: { size: "medium", alignment: "end" },
})

const leadingVariants = cva("flex min-w-0 items-center", {
  variants: { size: { small: "gap-1", medium: "gap-2" } },
  defaultVariants: { size: "medium" },
})

const actionsVariants = cva("flex min-w-0 flex-wrap items-center gap-1", {
  variants: { alignment: { end: "justify-end", split: "" } },
  defaultVariants: { alignment: "end" },
})

export type RootProps = {
  label?: string
  alignment?: "end" | "split"
  size?: "small" | "medium"
  leading?: ReactNode
  children?: ReactNode
}

export function Root(props: RootProps) {
  return (
    <Toolbar.Root
      aria-label={props.label}
      data-slot="toolbar"
      className={composeClasses(rootVariants({ size: props.size, alignment: props.alignment }))}
    >
      {props.leading ? (
        <div className={composeClasses(leadingVariants({ size: props.size }))}>{props.leading}</div>
      ) : null}
      {props.children ? (
        <div className={composeClasses(actionsVariants({ alignment: props.alignment }))}>{props.children}</div>
      ) : null}
    </Toolbar.Root>
  )
}

export type ButtonProps = {
  render: ReactElement
  disabled?: boolean
}

export function Button(props: ButtonProps) {
  return <Toolbar.Button render={props.render} disabled={props.disabled} focusableWhenDisabled={false} />
}

export type LinkProps = {
  render: ReactElement
}

export function Link(props: LinkProps) {
  return <Toolbar.Link render={props.render} />
}
