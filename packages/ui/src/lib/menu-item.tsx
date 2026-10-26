import { Menu } from "@base-ui/react/menu"
import { use } from "react"
import type { ReactNode } from "react"
import { Icon } from "../components/icon.js"
import { composeClasses } from "./compose-classes.js"
import { itemVariants, MenuDensity, menuLabel } from "./menu-chrome.js"

const markedItem = { regular: "pr-8", spacious: "gap-2 pr-8 pl-8" }
const markIndicator = { regular: "absolute right-2 flex items-center", spacious: "absolute left-2 flex items-center" }

export type ItemProps = {
  tone?: "neutral" | "danger"
  icon?: ReactNode
  detail?: ReactNode
  shortcut?: ReactNode
  disabled?: boolean
  closeOnSelect?: boolean
  onSelect?: () => void
  children: ReactNode
}

export function Item(props: ItemProps) {
  const density = use(MenuDensity)
  return (
    <Menu.Item
      data-slot="menu-item"
      disabled={props.disabled}
      closeOnClick={props.closeOnSelect ?? true}
      onClick={props.onSelect}
      className={composeClasses(itemVariants({ tone: props.tone ?? "neutral", density }))}
    >
      {props.icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2 truncate">{menuLabel(props.children)}</span>
      </span>
      {props.detail ? (
        <span className="max-w-1/2 shrink-0 truncate text-xs text-text-secondary">{props.detail}</span>
      ) : null}
      {props.shortcut ? <span className="ml-auto pl-4 text-xs text-text-secondary">{props.shortcut}</span> : null}
    </Menu.Item>
  )
}

export type CheckboxItemProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  icon?: ReactNode
  disabled?: boolean
  children: ReactNode
}

export function CheckboxItem(props: CheckboxItemProps) {
  const density = use(MenuDensity)
  return (
    <Menu.CheckboxItem
      data-slot="menu-item"
      checked={props.checked}
      disabled={props.disabled}
      onCheckedChange={(next) => props.onCheckedChange(next)}
      closeOnClick={false}
      className={composeClasses(itemVariants({ tone: "neutral", density }), markedItem[density])}
    >
      {props.icon}
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{menuLabel(props.children)}</span>
      <Menu.CheckboxItemIndicator className={markIndicator[density]}>
        <Icon glyph="Check" />
      </Menu.CheckboxItemIndicator>
    </Menu.CheckboxItem>
  )
}

export type RadioItemProps = {
  value: string
  icon?: ReactNode
  closeOnSelect?: boolean
  children: ReactNode
}

export function RadioItem(props: RadioItemProps) {
  const density = use(MenuDensity)
  return (
    <Menu.RadioItem
      data-slot="menu-item"
      value={props.value}
      closeOnClick={props.closeOnSelect ?? true}
      className={composeClasses(itemVariants({ tone: "neutral", density }), markedItem[density])}
    >
      {props.icon}
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{menuLabel(props.children)}</span>
      <Menu.RadioItemIndicator className={markIndicator[density]}>
        <Icon glyph="Check" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  )
}
