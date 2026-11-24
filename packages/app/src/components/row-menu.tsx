import { Fragment, useState, type ReactElement, type ReactNode } from "react"
import { IconDots, type Icon } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@ren/ui/context-menu"
import { ConfirmDialog, type Confirmation } from "./confirm-dialog.js"

export interface RowMenuItem {
  readonly label: string
  readonly icon: Icon
  readonly onSelect: () => void | Promise<unknown>
  readonly confirm?: Confirmation | undefined
  readonly destructive?: boolean | undefined
}

const separated = (items: ReadonlyArray<RowMenuItem>, index: number) =>
  Boolean(items[index]?.confirm) && index > 0 && !items[index - 1]?.confirm

const variantOf = (item: RowMenuItem) => ((item.destructive ?? Boolean(item.confirm)) ? "destructive" : "default")

function useChoice() {
  const [confirming, setConfirming] = useState<RowMenuItem>()
  const [chosen, setChosen] = useState<RowMenuItem>()
  return {
    choose: setChosen,
    onOpenChangeComplete: (open: boolean) => {
      if (open || !chosen) return
      setChosen(undefined)
      if (chosen.confirm) setConfirming(chosen)
      else void chosen.onSelect()
    },
    dialog: confirming?.confirm ? (
      <ConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined)
        }}
        confirmation={confirming.confirm}
        onConfirm={confirming.onSelect}
      />
    ) : null,
  }
}

export function RowMenu(props: {
  label: string
  items: ReadonlyArray<RowMenuItem>
  className?: string | undefined
  side?: "top" | "right" | "bottom" | "left"
}) {
  const choice = useChoice()
  if (props.items.length === 0) return null
  return (
    <>
      <DropdownMenu onOpenChangeComplete={choice.onOpenChangeComplete}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={props.className ?? "-my-1 flex text-muted-foreground"}
              aria-label={props.label}
            />
          }
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent side={props.side ?? "bottom"} align="end" className="w-auto min-w-44">
          <DropdownMenuGroup>
            {props.items.map((item, index) => (
              <Fragment key={item.label}>
                {separated(props.items, index) ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant={variantOf(item)} onClick={() => choice.choose(item)}>
                  <item.icon />
                  {item.label}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {choice.dialog}
    </>
  )
}

export function RowContextMenu(props: {
  items: ReadonlyArray<RowMenuItem>
  render: ReactElement
  children: ReactNode
}) {
  const choice = useChoice()
  return (
    <>
      <ContextMenu onOpenChangeComplete={choice.onOpenChangeComplete}>
        <ContextMenuTrigger render={props.render}>{props.children}</ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {props.items.map((item, index) => (
            <Fragment key={item.label}>
              {separated(props.items, index) ? <ContextMenuSeparator /> : null}
              <ContextMenuItem variant={variantOf(item)} onClick={() => choice.choose(item)}>
                <item.icon />
                {item.label}
              </ContextMenuItem>
            </Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      {choice.dialog}
    </>
  )
}
