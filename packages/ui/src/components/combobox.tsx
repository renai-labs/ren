export * as Combobox from "./combobox.js"

import { Combobox } from "@base-ui/react/combobox"
import { cva } from "class-variance-authority"
import { useRef, useState } from "react"
import type { KeyboardEvent, KeyboardEventHandler, ReactElement, ReactNode } from "react"
import { Body } from "../lib/combobox-list.js"
import type { Group, ListChrome, Option } from "../lib/combobox-list.js"
import { composeClasses } from "../lib/compose-classes.js"
import { popupSurface } from "../lib/control-chrome.js"

export type { Group, Option }

const popupVariants = cva(
  composeClasses(
    popupSurface,
    "flex max-h-(--available-height) min-h-0 max-w-[calc(100vw-var(--ren-spacing-8))] flex-col overflow-hidden",
  ),
  {
    variants: { width: { trigger: "w-(--anchor-width) min-w-56", medium: "w-72", large: "w-96" } },
    defaultVariants: { width: "medium" },
  },
)

type Selection =
  | {
      selection?: "single"
      value?: string | null
      defaultValue?: string | null
      onValueChange?: (value: string | null) => void
    }
  | {
      selection: "multiple"
      value?: readonly string[]
      defaultValue?: readonly string[]
      onValueChange?: (value: string[]) => void
    }

export type ListProps = Selection &
  ListChrome & {
    items?: readonly Option[]
    groups?: readonly Group[]
    query?: string
    onQueryChange?: (query: string) => void
    filtering?: "internal" | "external"
    onSearchKeyDown?: KeyboardEventHandler<HTMLInputElement>
  }

export type PopoverProps = ListProps & {
  trigger?: ReactElement
  width?: "trigger" | "medium" | "large"
  alignment?: "start" | "end"
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  closeOnSelect?: boolean
}

type Presentation = "popover" | "inline" | "panel"

export function Popover(props: PopoverProps) {
  return <Options {...props} presentation="popover" />
}

export function Inline(props: ListProps) {
  return <Options {...props} presentation="inline" />
}

export function Panel(props: ListProps) {
  return <Options {...props} presentation="panel" />
}

function allGroups(props: ListProps): readonly Group[] {
  return props.groups ?? [{ value: "all", items: props.items ?? [] }]
}

function filterGroups(groups: readonly Group[], query: string, external: boolean) {
  const needle = query.trim().toLowerCase()
  if (external || !needle) return groups.filter((group) => group.items.length > 0)
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [item.label, ...(item.keywords ?? [])].some((text) => text.toLowerCase().includes(needle)),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

function Options(props: PopoverProps & { presentation: Presentation }) {
  const closeOnSelect = props.closeOnSelect ?? props.selection !== "multiple"
  const popover = props.presentation === "popover"
  const [localQuery, setLocalQuery] = useState("")
  const [localOpen, setLocalOpen] = useState(props.defaultOpen === true)
  const [single, setSingle] = useState(props.selection === "multiple" ? null : props.defaultValue)
  const [many, setMany] = useState(props.selection === "multiple" ? props.defaultValue : undefined)
  const highlighted = useRef<string | undefined>(undefined)
  const query = props.query ?? localQuery
  const groups = allGroups(props)
  const labels = new Map(groups.flatMap((group) => group.items.map((item) => [item.value, item.label] as const)))
  const filtered = filterGroups(groups, query, props.filtering === "external")
  const changeOpen = (next: boolean) => {
    if (!next) setLocalQuery("")
    setLocalOpen(next)
    props.onOpenChange?.(next)
  }
  const selectSingle = (next: string | null) => {
    setSingle(next)
    if (props.selection !== "multiple") props.onValueChange?.(next)
  }
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    props.onSearchKeyDown?.(event)
    if (event.defaultPrevented || event.key !== "Enter" || highlighted.current !== undefined) return
    const first = filtered[0]?.items.find((item) => !item.disabled)
    if (props.selection === "multiple" || !first) return
    event.preventDefault()
    selectSingle(first.value)
    if (closeOnSelect && popover) changeOpen(false)
  }
  const root = {
    items: groups,
    filteredItems: filtered,
    inline: !popover,
    autoHighlight: true,
    open: popover ? (props.open ?? localOpen) : true,
    onOpenChange: (next: boolean, details: Combobox.Root.ChangeEventDetails) => {
      if (!next && !closeOnSelect && details.reason === "item-press") return
      changeOpen(next)
    },
    inputValue: query,
    onInputValueChange: (next: string) => (props.onQueryChange ? props.onQueryChange(next) : setLocalQuery(next)),
    itemToStringLabel: (value: string) => labels.get(value) ?? value,
    onItemHighlighted: (value: string | undefined) => {
      highlighted.current = value
    },
  }
  const content = (
    <Container {...props}>
      <Body {...props} focusOnMount={!popover} onKeyDown={handleSearchKeyDown} />
    </Container>
  )
  if (props.selection === "multiple")
    return (
      <Combobox.Root
        {...root}
        multiple
        value={[...(props.value ?? many ?? [])]}
        onValueChange={(next) => {
          setMany(next)
          props.onValueChange?.(next)
          if (closeOnSelect && popover) changeOpen(false)
        }}
      >
        {content}
      </Combobox.Root>
    )
  return (
    <Combobox.Root
      {...root}
      value={props.value === undefined ? (single ?? null) : props.value}
      onValueChange={selectSingle}
    >
      {content}
    </Combobox.Root>
  )
}

function Container(props: PopoverProps & { presentation: Presentation; children: ReactNode }) {
  if (props.presentation === "inline")
    return (
      <div
        data-slot="option-list"
        className="flex max-h-72 min-h-0 flex-col overflow-hidden rounded-control bg-fill-primary inset-ring-1 inset-ring-border-primary"
      >
        {props.children}
      </div>
    )
  if (props.presentation === "panel")
    return (
      <div data-slot="option-list" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {props.children}
      </div>
    )
  return (
    <>
      {props.trigger ? <Combobox.Trigger render={props.trigger} /> : null}
      <Combobox.Portal>
        <Combobox.Positioner
          data-ren-layer=""
          align={props.alignment ?? "start"}
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={{ align: "shift" }}
          className="z-50 flex max-h-110 flex-col"
        >
          <Combobox.Popup
            data-slot="option-list"
            aria-label={props.label}
            className={composeClasses(popupVariants({ width: props.width }))}
          >
            {props.children}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </>
  )
}
