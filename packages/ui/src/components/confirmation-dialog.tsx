import { useState } from "react"
import type { ReactNode } from "react"
import { Button } from "./button.js"
import { Dialog } from "./dialog.js"
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
    <Dialog.AlertRoot
      open={props.open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        props.onOpenChange(next)
      }}
      dismissal={pending ? "blocked" : "allowed"}
    >
      <Dialog.Content size="medium">
        <Dialog.Header>
          <Dialog.Title>{props.title}</Dialog.Title>
          {props.description ? <Dialog.Description>{props.description}</Dialog.Description> : null}
        </Dialog.Header>
        {props.children || error ? (
          <Dialog.Body>
            {props.children}
            {error ? (
              <Text purpose="caption" tone="danger" aria-live="polite">
                {error}
              </Text>
            ) : null}
          </Dialog.Body>
        ) : null}
        <Dialog.Footer alignment="split">
          <Dialog.Close disabled={pending} />
          <Button appearance={props.tone === "danger" ? "danger" : "primary"} pending={pending} onClick={confirm}>
            {props.confirmLabel ?? "Delete"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.AlertRoot>
  )
}
