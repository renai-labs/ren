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
      <SheetContent data-chat-sheet="" className="data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>{props.description}</SheetDescription>
        </SheetHeader>
        <SessionSheetBody>{props.children}</SessionSheetBody>
      </SheetContent>
    </Sheet>
  )
}

export function SessionSheetBody(props: { children: ReactNode }) {
  return (
    <div data-slot="chat-sheet-body" className="flex min-h-0 flex-1 flex-col [--container-chat:--spacing(192)]">
      {props.children}
    </div>
  )
}
