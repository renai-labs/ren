export * as FormActions from "./form-actions.js"

import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"

const rootVariants = cva("flex w-full items-center gap-2", {
  variants: { alignment: { end: "justify-end", split: "justify-between" } },
})

export function Root(props: { alignment?: "end" | "split"; children: ReactNode }) {
  return (
    <div data-slot="form-actions" className={composeClasses(rootVariants({ alignment: props.alignment ?? "end" }))}>
      {props.children}
    </div>
  )
}

export function Cancel(props: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button appearance="ghost" onClick={props.onClick} disabled={props.disabled}>
      Cancel
    </Button>
  )
}

export type SubmitProps = {
  pending: boolean
  pendingLabel: string
  disabled?: boolean
  onClick?: () => void
  form?: string
  children: ReactNode
}

export function Submit(props: SubmitProps) {
  return (
    <Button
      form={props.form}
      type={props.onClick === undefined ? "submit" : "button"}
      onClick={props.onClick}
      pending={props.pending}
      pendingLabel={props.pendingLabel}
      disabled={props.disabled}
      appearance="primary"
    >
      {props.children}
    </Button>
  )
}
