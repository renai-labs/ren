export * as Tabs from "./tabs.js"

import { Tabs } from "@base-ui/react/tabs"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority"
import { createContext, use } from "react"
import type { ReactElement, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"

export type TabsSize = "small" | "medium"

const tabVariants = cva(
  "relative inline-flex shrink-0 items-center gap-2 rounded-control px-3 whitespace-nowrap text-text-secondary transition-standard hover:bg-fill-primary hover:text-text-primary focus-visible:-outline-offset-2 aria-selected:bg-fill-secondary aria-selected:font-medium aria-selected:text-text-primary aria-[current=page]:bg-fill-secondary aria-[current=page]:font-medium aria-[current=page]:text-text-primary data-disabled:pointer-events-none data-disabled:opacity-disabled [&_svg]:size-4",
  {
    variants: { size: { small: "h-7 text-xs", medium: "h-8 text-sm" } },
    defaultVariants: { size: "medium" },
  },
)

const listClasses = "relative isolate flex max-w-full items-center gap-1 overflow-x-auto"

const SizeContext = createContext<TabsSize>("medium")

export type RootProps<Value extends string> = {
  value: Value | null
  onValueChange: (value: Value) => void
  children: ReactNode
}

export function Root<Value extends string>(props: RootProps<Value>) {
  return (
    <Tabs.Root
      value={props.value}
      onValueChange={(next: Value | null) => {
        if (next !== null) props.onValueChange(next)
      }}
      data-slot="tabs"
      className="flex min-w-0 flex-col gap-4"
    >
      {props.children}
    </Tabs.Root>
  )
}

export type ListProps = {
  label: string
  size?: TabsSize
  children: ReactNode
}

export function List(props: ListProps) {
  return (
    <SizeContext value={props.size ?? "medium"}>
      <Tabs.List aria-label={props.label} data-slot="tabs-list" className={listClasses}>
        {props.children}
      </Tabs.List>
    </SizeContext>
  )
}

export type TabProps = {
  value: string
  icon?: ReactNode
  count?: number
  disabled?: boolean
  render?: ReactElement
  children: ReactNode
}

export function Tab(props: TabProps) {
  const size = use(SizeContext)
  return (
    <Tabs.Tab
      value={props.value}
      disabled={props.disabled}
      render={props.render}
      nativeButton={props.render === undefined}
      data-slot="tab"
      className={composeClasses(tabVariants({ size }))}
    >
      <Label icon={props.icon} count={props.count}>
        {props.children}
      </Label>
    </Tabs.Tab>
  )
}

export function Panel(props: { value: string; children: ReactNode }) {
  return (
    <Tabs.Panel value={props.value} data-slot="tabs-panel" className="rounded-control">
      {props.children}
    </Tabs.Panel>
  )
}

export function Navigation(props: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={props.label} data-slot="tabs-navigation" className={listClasses}>
      {props.children}
    </nav>
  )
}

export type LinkProps = {
  render: ReactElement
  icon?: ReactNode
  count?: number
  children: ReactNode
}

export function Link(props: LinkProps) {
  return useRender({
    defaultTagName: "a",
    render: props.render,
    props: {
      "data-slot": "tab",
      className: composeClasses(tabVariants({ size: "medium" })),
      children: (
        <Label icon={props.icon} count={props.count}>
          {props.children}
        </Label>
      ),
    },
  })
}

function Label(props: { icon: ReactNode; count: number | undefined; children: ReactNode }) {
  return (
    <>
      {props.icon}
      {props.children}
      {props.count === undefined ? null : <span className="text-text-secondary tabular-nums">{props.count}</span>}
    </>
  )
}
