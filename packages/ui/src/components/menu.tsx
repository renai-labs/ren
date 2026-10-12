export * as Menu from "./menu.js"

import { Menu } from "@base-ui/react/menu"
import { cva } from "class-variance-authority"
import { use } from "react"
import type { ReactElement, ReactNode, RefObject } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { popupSurface } from "../lib/control-chrome.js"
import { itemVariants, MenuDensity, menuLabel } from "../lib/menu-chrome.js"
import type { Density } from "../lib/menu-chrome.js"
import { Icon } from "./icon.js"

export { Item, CheckboxItem, RadioItem } from "../lib/menu-item.js"
export type { ItemProps, CheckboxItemProps, RadioItemProps } from "../lib/menu-item.js"
export type { Density } from "../lib/menu-chrome.js"

export type Width = "content" | "trigger" | "small" | "medium" | "large"

const popupVariants = cva(
  composeClasses(popupSurface, "max-h-(--available-height) overflow-y-auto overscroll-contain p-1"),
  {
    variants: {
      width: {
        content: "min-w-40",
        trigger: "w-(--anchor-width)",
        small: "w-48",
        medium: "w-64",
        large: "w-72",
      },
    },
  },
)

const spaciousPopup = "rounded-container p-1"

export type RootProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

export function Root(props: RootProps) {
  return (
    <Menu.Root
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={(next) => props.onOpenChange?.(next)}
      modal={false}
    >
      {props.children}
    </Menu.Root>
  )
}

export function Trigger(props: { render: ReactElement }) {
  return <Menu.Trigger render={props.render} />
}

export type PopupProps = {
  anchor?: RefObject<HTMLElement | null>
  placement?: "top" | "bottom"
  alignment?: "start" | "center" | "end"
  width?: Width
  restoreFocus?: boolean
  density?: Density
  children: ReactNode
}

export function Popup(props: PopupProps) {
  const density = props.density ?? "regular"
  return (
    <Menu.Portal>
      <Menu.Positioner
        data-ren-layer=""
        anchor={props.anchor}
        side={props.placement ?? "bottom"}
        align={props.alignment ?? "start"}
        sideOffset={4}
        collisionPadding={8}
        className="z-50"
      >
        <Menu.Popup
          data-slot="menu"
          finalFocus={props.restoreFocus === false ? false : undefined}
          className={composeClasses(
            popupVariants({ width: props.width ?? "content" }),
            density === "spacious" && spaciousPopup,
          )}
        >
          <MenuDensity value={density}>{props.children}</MenuDensity>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export type RadioGroupProps<Value extends string> = {
  value: Value
  onValueChange: (value: Value) => void
  children: ReactNode
}

export function RadioGroup<Value extends string>(props: RadioGroupProps<Value>) {
  return (
    <Menu.RadioGroup value={props.value} onValueChange={props.onValueChange}>
      {props.children}
    </Menu.RadioGroup>
  )
}

export function Section(props: { label: ReactNode; children: ReactNode }) {
  const density = use(MenuDensity)
  return (
    <Menu.Group className="flex flex-col">
      <Menu.GroupLabel
        className={
          density === "spacious"
            ? "px-3 py-2 text-xs text-text-secondary"
            : "px-2 pt-2 pb-1 text-xs text-text-secondary"
        }
      >
        {props.label}
      </Menu.GroupLabel>
      {props.children}
    </Menu.Group>
  )
}

export function Separator() {
  const density = use(MenuDensity)
  return (
    <Menu.Separator
      className={composeClasses("border-t border-border-primary", density === "spacious" ? "my-2" : "-mx-1 my-1")}
    />
  )
}

export function SubmenuRoot(props: { children: ReactNode }) {
  return <Menu.SubmenuRoot>{props.children}</Menu.SubmenuRoot>
}

export type SubmenuTriggerProps = {
  icon?: ReactNode
  description?: ReactNode
  detail?: ReactNode
  current?: boolean
  onActivate?: () => void
  children: ReactNode
}

export function SubmenuTrigger(props: SubmenuTriggerProps) {
  const density = use(MenuDensity)
  const activate = props.onActivate
  return (
    <Menu.SubmenuTrigger
      data-slot="menu-item"
      data-current={props.current === true || undefined}
      onClick={
        activate
          ? (event) => {
              event.preventDefault()
              activate()
            }
          : undefined
      }
      onKeyDown={
        activate
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              activate()
            }
          : undefined
      }
      className={composeClasses(
        itemVariants({ tone: "neutral", density }),
        "data-current:font-medium data-popup-open:bg-fill-secondary",
      )}
    >
      {props.icon}
      {props.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{menuLabel(props.children)}</span>
          <span className="truncate text-xs text-text-secondary">{props.description}</span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{menuLabel(props.children)}</span>
      )}
      {props.detail ? <span className="max-w-1/2 truncate text-text-secondary">{props.detail}</span> : null}
      <span className="ml-auto flex shrink-0">
        <Icon glyph="ChevronRight" />
      </span>
    </Menu.SubmenuTrigger>
  )
}

export function SubmenuPopup(props: { width?: Width; children: ReactNode }) {
  const density = use(MenuDensity)
  return (
    <Menu.Portal>
      <Menu.Positioner
        data-ren-layer=""
        side="right"
        align="start"
        sideOffset={density === "spacious" ? 6 : 4}
        className="z-50"
      >
        <Menu.Popup
          className={
            density === "spacious"
              ? composeClasses(popupVariants({ width: "content" }), spaciousPopup, "max-h-80 min-w-48")
              : popupVariants({ width: props.width ?? "medium" })
          }
        >
          {props.children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function Message(props: { children: ReactNode }) {
  return (
    <Menu.Item
      disabled
      closeOnClick={false}
      className="rounded-small p-2 text-sm text-text-secondary outline-none focus-visible:bg-fill-secondary"
    >
      {props.children}
    </Menu.Item>
  )
}
