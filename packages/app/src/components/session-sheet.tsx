import type { ReactNode } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ren/ui/sheet"

export function SessionSheet(props: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Sheet open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <SheetContent className="data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>{props.description}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col [--container-chat:--spacing(192)]">{props.children}</div>
      </SheetContent>
    </Sheet>
  )
}
