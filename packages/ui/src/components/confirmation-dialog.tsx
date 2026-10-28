import { useState } from "react"
import type { ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog.js"
import { Spinner } from "./spinner.js"
import { Text } from "./text.js"

export type ConfirmationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  tone?: "neutral" | "danger"
  onConfirm: () => unknown
  onConfirmed?: () => void
  children?: ReactNode
}

const fallbackError = "The action didn’t finish. Try again."

export function ConfirmationDialog(props: ConfirmationDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = () => {
    setPending(true)
    setError(null)
    void Promise.resolve()
      .then(props.onConfirm)
      .then(
        () => {
          setPending(false)
          props.onConfirmed?.()
          props.onOpenChange(false)
        },
        (cause: unknown) => {
          setPending(false)
          setError(cause instanceof Error ? cause.message : fallbackError)
        },
      )
  }
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next && pending) return
        if (!next) setError(null)
        props.onOpenChange(next)
      }}
    >
      <AlertDialogContent className="gap-3 text-sm ring-0 shadow-dialog data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="gap-1">
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          {props.description ? <AlertDialogDescription>{props.description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {props.children || error ? (
          <div className="flex flex-col gap-4">
            {props.children}
            {error ? (
              <Text purpose="caption" tone="danger" aria-live="polite">
                {error}
              </Text>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter className="mt-1 flex-col bg-transparent px-4 py-3 sm:justify-between">
          <AlertDialogCancel variant="ghost" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant={props.tone === "danger" ? "destructive" : "default"}
            className={
              props.tone === "danger"
                ? "bg-destructive text-primary-foreground hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
                : undefined
            }
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={confirm}
          >
            {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
            {props.confirmLabel ?? "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
