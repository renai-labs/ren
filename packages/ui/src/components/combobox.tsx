export * as Combobox from "./combobox.js"

import { Combobox } from "@base-ui/react/combobox"
import { cva } from "class-variance-authority"
import { useState } from "react"
import type { KeyboardEventHandler, ReactElement, ReactNode } from "react"
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
  return <Options {...props} presentation="inline" open />
}

export function Panel(props: ListProps) {
  return <Options {...props} presentation="panel" open />
}

function Options(props: PopoverProps & { presentation: Presentation }) {
  const closeOnSelect = props.closeOnSelect ?? props.selection !== "multiple"
  const popover = props.presentation === "popover"
  const closesAfterMultiplePick = popover && closeOnSelect && props.selection === "multiple"
  const [pickedOpen, setPickedOpen] = useState(props.defaultOpen === true)
  const collator = Combobox.useFilter()
  const items = Combobox.createItems(props.groups ?? [{ value: "all", items: props.items ?? [] }], {
    getValue: (item) => item.value,
    getLabel: (item) => item.label,
  })
  const changeOpen = (next: boolean) => {
    setPickedOpen(next)
    props.onOpenChange?.(next)
  }
  const root = {
    items,
    filter:
      props.filtering === "external"
        ? null
        : (item: Option, query: string) =>
            [item.label, ...(item.keywords ?? [])].some((text) => collator.contains(text, query)),
    inline: !popover,
    autoHighlight: true,
    defaultInputValue: "",
    inputValue: props.query,
    onInputValueChange: props.onQueryChange,
    defaultOpen: props.defaultOpen,
    open: props.open ?? (closesAfterMultiplePick ? pickedOpen : undefined),
    onOpenChange: (next: boolean, details: Combobox.Root.ChangeEventDetails) => {
      if (!next && !closeOnSelect && details.reason === "item-press") return details.cancel()
      changeOpen(next)
    },
  }
  const content = (
    <Container {...props}>
      <Body {...props} focusOnMount={!popover} pickFirstOnEnter={props.selection !== "multiple"} />
    </Container>
  )
  if (props.selection === "multiple")
    return (
      <Combobox.Root
        {...root}
        multiple
        value={props.value && [...props.value]}
        defaultValue={props.defaultValue && [...props.defaultValue]}
        onValueChange={(next) => {
          props.onValueChange?.(next)
          if (closesAfterMultiplePick) changeOpen(false)
        }}
      >
        {content}
      </Combobox.Root>
    )
  return (
    <Combobox.Root {...root} value={props.value} defaultValue={props.defaultValue} onValueChange={props.onValueChange}>
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
