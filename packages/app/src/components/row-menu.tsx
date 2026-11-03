import { Fragment, useState } from "react"
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
import { ConfirmDialog, type Confirmation } from "./confirm-dialog.js"

export interface RowMenuItem {
  readonly label: string
  readonly icon: Icon
  readonly onSelect: () => void | Promise<unknown>
  readonly confirm?: Confirmation | undefined
}

export function RowMenu(props: {
  label: string
  items: ReadonlyArray<RowMenuItem>
  className?: string | undefined
  side?: "top" | "right" | "bottom" | "left"
}) {
  const [confirming, setConfirming] = useState<RowMenuItem>()
  const [chosen, setChosen] = useState<RowMenuItem>()
  if (props.items.length === 0) return null
  return (
    <>
      <DropdownMenu
        onOpenChangeComplete={(open) => {
          if (open || !chosen) return
          setChosen(undefined)
          if (chosen.confirm) setConfirming(chosen)
          else void chosen.onSelect()
        }}
      >
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
        <DropdownMenuContent side={props.side ?? "bottom"} align="end" className="w-44">
          <DropdownMenuGroup>
            {props.items.map((item, index) => (
              <Fragment key={item.label}>
                {item.confirm && index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant={item.confirm ? "destructive" : "default"} onClick={() => setChosen(item)}>
                  <item.icon />
                  {item.label}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming?.confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(undefined)
          }}
          confirmation={confirming.confirm}
          onConfirm={confirming.onSelect}
        />
      ) : null}
    </>
  )
}
