import { Fragment, useState, type ReactNode } from "react"
import { IconDots } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog, type Confirmation } from "@/components/ren/confirm-dialog"

export interface RowMenuItem {
  readonly label: string
  readonly icon?: ReactNode | undefined
  readonly onSelect: () => void | Promise<unknown>
  readonly confirm?: Confirmation | undefined
}

export function RowMenu(props: { label: string; items: ReadonlyArray<RowMenuItem>; className?: string | undefined }) {
  const [confirming, setConfirming] = useState<RowMenuItem>()
  if (props.items.length === 0) return null
  return (
    <>
      <DropdownMenu>
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
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            {props.items.map((item, index) => (
              <Fragment key={item.label}>
                {item.confirm && index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  variant={item.confirm ? "destructive" : "default"}
                  onClick={() => (item.confirm ? setConfirming(item) : void item.onSelect())}
                >
                  {item.icon}
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
