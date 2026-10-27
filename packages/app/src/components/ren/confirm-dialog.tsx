import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

export type Confirmation = {
  title: string
  description: string
  action: string
}

export function ConfirmDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  confirmation: Confirmation
  onConfirm: () => void | Promise<unknown>
}) {
  const [pending, setPending] = useState(false)
  const confirm = async () => {
    setPending(true)
    try {
      await props.onConfirm()
      props.onOpenChange(false)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={props.open} onOpenChange={(open) => (pending ? undefined : props.onOpenChange(open))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.confirmation.title}</DialogTitle>
          <DialogDescription>{props.confirmation.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />} disabled={pending}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            className="bg-destructive text-primary-foreground hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {props.confirmation.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
