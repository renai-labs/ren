export * as Combobox from "./combobox.js"

import { Combobox } from "@base-ui/react/combobox"
import { cva } from "class-variance-authority"
import { useState } from "react"
import type { KeyboardEventHandler, ReactElement, ReactNode } from "react"
import { Body } from "../lib/combobox-list.js"
import type { ListChrome } from "../lib/combobox-list.js"
import { useSelection, useTree } from "../lib/combobox-state.js"
import type { Create, Selection } from "../lib/combobox-state.js"
import { matches } from "../lib/combobox-tree.js"
import type { CreateStep, Group, Option, Row } from "../lib/combobox-tree.js"
import { composeClasses } from "../lib/compose-classes.js"
import { popupSurface } from "../lib/control-chrome.js"

export type { Create, CreateStep, Group, Option }

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

export type ListProps = Selection &
  ListChrome & {
    items?: readonly Option[] | undefined
    groups?: readonly Group[]
    query?: string
    onQueryChange?: (query: string) => void
    filtering?: "internal" | "external"
    onSearchKeyDown?: KeyboardEventHandler<HTMLInputElement>
    onCreate?: Create
    createLabel?: ((query: string) => string) | undefined
    createStep?: CreateStep
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
  const [ownOpen, setOwnOpen] = useState(props.defaultOpen === true)
  const collator = Combobox.useFilter()
  const groups = props.groups ?? [{ value: "all", items: props.items ?? [] }]
  const selected = useSelection(props, groups)
  const changeOpen = (next: boolean) => {
    setOwnOpen(next)
    props.onOpenChange?.(next)
  }
  const tree = useTree({
    ...props,
    groups,
    select: (created) => {
      selected.add(created)
      if (popover && closeOnSelect) changeOpen(false)
    },
  })
  const root = {
    items: Combobox.createItems(tree.sections, { getValue: (row) => row.value, getLabel: (row) => row.label }),
    filter:
      props.filtering === "external"
        ? null
        : (row: Row, search: string) => matches(row, (text) => collator.contains(text, search)),
    inline: !popover,
    autoHighlight: true,
    inputValue: tree.query,
    onInputValueChange: tree.changeQuery,
    onItemHighlighted: tree.highlight,
    open: props.open ?? ownOpen,
    onOpenChange: (next: boolean, details: Combobox.Root.ChangeEventDetails) => {
      if (!next && details.reason === "escape-key" && tree.nested) {
        details.cancel()
        return tree.tree.back()
      }
      if (!next && !closeOnSelect && details.reason === "item-press") return details.cancel()
      if (!next) tree.reset()
      changeOpen(next)
    },
  }
  const content = (
    <Container {...props}>
      <Body
        {...props}
        tree={tree.tree}
        onTreeKeyDown={(event) => tree.keyDown(event, !popover)}
        focusOnMount={!popover}
        pickFirstOnEnter={props.selection !== "multiple"}
      />
    </Container>
  )
  if (props.selection === "multiple")
    return (
      <Combobox.Root
        {...root}
        multiple
        value={[...selected.values]}
        onValueChange={(next) => {
          selected.changeValues(next)
          tree.picked(selected.values, next)
          if (popover && closeOnSelect) changeOpen(false)
        }}
      >
        {content}
      </Combobox.Root>
    )
  return (
    <Combobox.Root {...root} value={selected.value} onValueChange={selected.changeValue}>
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
