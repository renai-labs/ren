export * as Dialog from "./dialog.js"

import { AlertDialog } from "@base-ui/react/alert-dialog"
import { Dialog } from "@base-ui/react/dialog"
import { cva } from "class-variance-authority"
import { createContext, use } from "react"
import type { ReactElement, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { IconButton } from "./icon-button.js"
import { Icon } from "./icon.js"
import { Text } from "./text.js"

type Dismissal = "allowed" | "blocked"

const DismissalContext = createContext<Dismissal>("allowed")

export type RootProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  dismissal?: Dismissal
  children: ReactNode
}

function guard(props: RootProps) {
  // ast-grep-ignore: no-boolean-flag-parameter -- Base UI's onOpenChange signature
  return (next: boolean, details: { reason: string; cancel: () => void }) => {
    if (!next && props.dismissal === "blocked" && details.reason !== "imperative-action") {
      details.cancel()
      return
    }
    props.onOpenChange?.(next)
  }
}

export function Root(props: RootProps) {
  return (
    <DismissalContext value={props.dismissal ?? "allowed"}>
      <Dialog.Root
        open={props.open}
        defaultOpen={props.defaultOpen}
        disablePointerDismissal={props.dismissal === "blocked"}
        onOpenChange={guard(props)}
      >
        {props.children}
      </Dialog.Root>
    </DismissalContext>
  )
}

export function AlertRoot(props: RootProps) {
  return (
    <DismissalContext value={props.dismissal ?? "allowed"}>
      <AlertDialog.Root open={props.open} defaultOpen={props.defaultOpen} onOpenChange={guard(props)}>
        {props.children}
      </AlertDialog.Root>
    </DismissalContext>
  )
}

export function Trigger(props: { children: ReactElement }) {
  return <Dialog.Trigger render={props.children} />
}

const popupVariants = cva(
  // oxlint-disable-next-line ren/require-companion-class -- the popup takes focus only as a fallback container; its controls draw their own rings
  "fixed z-50 flex flex-col bg-background-secondary text-text-primary shadow-dialog transition-extended outline-none",
  {
    variants: {
      presentation: {
        centered:
          "left-1/2 max-h-[calc(100dvh-var(--ren-spacing-8))] w-[calc(100vw-var(--ren-spacing-8))] -translate-x-1/2 rounded-container data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
        side: "inset-y-0 right-0 h-dvh w-full max-w-[calc(100vw-var(--ren-spacing-12))] rounded-l-container border-l border-border-primary data-ending-style:translate-x-full data-ending-style:opacity-0 data-starting-style:translate-x-full data-starting-style:opacity-0",
      },
      size: { small: "", medium: "", large: "", wide: "", "extra-large": "", "extra-wide": "" },
      placement: { center: "", top: "" },
      height: { content: "", compact: "", standard: "", tall: "" },
    },
    compoundVariants: [
      { presentation: "centered", size: "small", className: "sm:max-w-96" },
      { presentation: "centered", size: "medium", className: "sm:max-w-dialog" },
      { presentation: "centered", size: "large", className: "sm:max-w-168" },
      { presentation: "centered", size: "wide", className: "sm:max-w-192" },
      { presentation: "centered", size: "extra-large", className: "sm:max-w-224" },
      { presentation: "centered", size: "extra-wide", className: "sm:max-w-256" },
      {
        presentation: "centered",
        height: "tall",
        className:
          "h-[min(calc(var(--ren-container-content)-var(--ren-spacing-12)-var(--ren-spacing-12)),calc(100dvh-var(--ren-spacing-8)))]",
      },
      { presentation: "centered", height: "compact", className: "h-120" },
      { presentation: "centered", height: "standard", className: "h-170" },
      { presentation: "centered", placement: "center", className: "top-1/2 -translate-y-1/2" },
      {
        presentation: "centered",
        placement: "top",
        className: "top-[12vh] max-h-[calc(88dvh-var(--ren-spacing-8))]",
      },
      { presentation: "side", size: "medium", className: "sm:max-w-105" },
      { presentation: "side", size: "large", className: "sm:max-w-140" },
      { presentation: "side", size: "extra-large", className: "sm:max-w-240" },
    ],
    defaultVariants: { presentation: "centered", size: "medium", placement: "center", height: "content" },
  },
)

export type ContentProps = {
  presentation?: "centered" | "side"
  size?: "small" | "medium" | "large" | "wide" | "extra-large" | "extra-wide"
  placement?: "center" | "top"
  height?: "content" | "compact" | "standard" | "tall"
  closeButton?: "visible" | "hidden"
  closeLabel?: string
  children: ReactNode
}

export function Content(props: ContentProps) {
  const dismissal = use(DismissalContext)
  return (
    <Dialog.Portal>
      <Dialog.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-overlay-primary transition-extended data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <Dialog.Popup
        data-slot="dialog-content"
        data-presentation={props.presentation ?? "centered"}
        className={composeClasses(
          popupVariants({
            presentation: props.presentation,
            size: props.size,
            placement: props.placement,
            height: props.height,
          }),
        )}
      >
        {props.children}
        {props.closeButton === "hidden" ? null : (
          <span className="absolute top-3 right-3">
            <Dialog.Close
              disabled={dismissal === "blocked"}
              render={
                <IconButton label={props.closeLabel ?? "Close"} size="small">
                  <Icon glyph="X" />
                </IconButton>
              }
            />
          </span>
        )}
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

export function Header(props: { children: ReactNode }) {
  return <header className="flex shrink-0 flex-col gap-1 px-4 pt-4 pr-12 pb-3">{props.children}</header>
}

type Visibility = "visible" | "hidden"

export function Title(props: { visibility?: Visibility; children: ReactNode }) {
  return (
    <Dialog.Title
      render={
        <Text purpose="heading" element="h2" visibility={props.visibility === "hidden" ? "assistive" : "visible"} />
      }
    >
      {props.children}
    </Dialog.Title>
  )
}

export function Description(props: { visibility?: Visibility; children: ReactNode }) {
  return (
    <Dialog.Description
      render={
        <Text
          purpose="body"
          tone="secondary"
          element="p"
          visibility={props.visibility === "hidden" ? "assistive" : "visible"}
        />
      }
    >
      {props.children}
    </Dialog.Description>
  )
}

export function Body(props: { layout?: "padded" | "flush"; children: ReactNode }) {
  return (
    <div
      data-slot="dialog-body"
      className={composeClasses(
        "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain",
        props.layout !== "flush" && "gap-4 px-4 pb-4",
      )}
    >
      {props.children}
    </div>
  )
}

export function Footer(props: { alignment?: "end" | "split"; children: ReactNode }) {
  return (
    <footer
      data-slot="dialog-footer"
      className={composeClasses(
        "flex shrink-0 flex-col gap-2 border-t border-border-primary px-4 py-3 sm:flex-row sm:items-center",
        props.alignment === "split" ? "sm:justify-between" : "sm:justify-end",
      )}
    >
      {props.children}
    </footer>
  )
}

export function Close(props: { disabled?: boolean; render?: ReactElement; children?: ReactNode }) {
  return (
    <Dialog.Close
      disabled={props.disabled}
      render={props.render ?? <Button appearance="ghost">{props.children ?? "Cancel"}</Button>}
    />
  )
}
