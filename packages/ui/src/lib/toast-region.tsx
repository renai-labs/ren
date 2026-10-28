import { Toast } from "@base-ui/react/toast"
import { cva } from "class-variance-authority"
import { composeClasses } from "./compose-classes.js"
import { Button } from "../components/button.js"
import { Icon } from "../components/icon.js"
import type { Glyph, IconTone } from "../components/icon.js"
import type { RegionProps, ToastType } from "../components/toast.js"

type Placement = NonNullable<RegionProps["placement"]>

const regionVariants = cva("fixed z-50 max-sm:inset-x-4 sm:w-89", {
  variants: {
    placement: {
      "bottom-right": "bottom-6 max-sm:bottom-4 sm:right-6",
      "top-center": "top-6 max-sm:top-4 sm:left-1/2 sm:-translate-x-1/2",
    },
  },
  defaultVariants: { placement: "bottom-right" },
})

const toastVariants = cva(
  "absolute z-[calc(1000-var(--toast-index))] flex h-(--height) w-full transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--lift)*var(--toast-index)*var(--gap)+var(--toast-swipe-movement-y)))_scale(var(--scale))] items-center gap-1.5 rounded-container border border-border-primary bg-background-secondary p-4 font-sans wrap-anywhere text-text-primary shadow-overlay transition-extended outline-none select-none [--gap:--spacing(3.5)] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--lift)*(var(--toast-offset-y)+var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))] [--scale:calc(1-var(--toast-index)*0.05)] after:absolute after:left-0 after:h-(--gap) after:w-full focus-visible:outline-2 focus-visible:outline-accent-primary data-ending-style:opacity-0 data-expanded:h-(--toast-height) data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-limited:opacity-0 data-starting-style:transform-[translateY(calc(var(--lift)*-100%))] data-starting-style:opacity-0 data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))] data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))] [&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:transform-[translateY(calc(var(--lift)*-100%))]",
  {
    variants: {
      placement: {
        "bottom-right": "right-0 bottom-0 origin-bottom [--lift:-1] after:top-full",
        "top-center": "top-0 right-0 origin-top [--lift:1] after:bottom-full",
      },
    },
    defaultVariants: { placement: "bottom-right" },
  },
)

const glyphs: Record<ToastType, { glyph: Glyph; tone: IconTone }> = {
  success: { glyph: "CheckCircle", tone: "success" },
  error: { glyph: "AlertCircle", tone: "danger" },
  warning: { glyph: "AlertTriangle", tone: "warning" },
  info: { glyph: "Info", tone: "primary" },
  loading: { glyph: "Loader2", tone: "primary" },
}

const isToastType = (type: string | undefined): type is ToastType =>
  type === "success" || type === "error" || type === "warning" || type === "info" || type === "loading"

export function ToastRegion(props: RegionProps) {
  return (
    <Toast.Portal>
      <Toast.Viewport
        data-slot="notification-region"
        className={composeClasses(regionVariants({ placement: props.placement }))}
      >
        <List placement={props.placement ?? "bottom-right"} closeButton={props.closeButton ?? "visible"} />
      </Toast.Viewport>
    </Toast.Portal>
  )
}

function List(props: { placement: Placement; closeButton: "visible" | "hidden" }) {
  const toastManager = Toast.useToastManager()
  return toastManager.toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      data-slot="notification"
      swipeDirection={props.placement === "top-center" ? "up" : ["down", "right"]}
      className={composeClasses(toastVariants({ placement: props.placement }))}
    >
      <Toast.Content className="flex min-w-0 flex-1 items-center gap-1.5 transition-extended data-behind:opacity-0 data-expanded:opacity-100">
        {isToastType(toast.type) ? <TypeIcon type={toast.type} /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Toast.Title className="text-sm/normal font-medium" />
          <Toast.Description className="text-xs/[1.4] text-text-secondary" />
        </div>
        <Toast.Action render={<Button appearance="primary" size="small" />} />
        {props.closeButton === "visible" ? (
          <Toast.Close
            aria-label="Close notification"
            className="absolute top-0 left-0 z-1 flex size-5 translate-[-35%] items-center justify-center rounded-full border border-border-primary bg-background-secondary text-text-primary transition-standard hover:bg-background-tertiary"
          >
            <Icon glyph="X" size="extra-small" />
          </Toast.Close>
        ) : null}
      </Toast.Content>
    </Toast.Root>
  ))
}

function TypeIcon(props: { type: ToastType }) {
  return (
    <span
      data-slot="notification-icon"
      className={composeClasses(
        "-ms-0.75 me-1 flex size-4 shrink-0 items-center",
        props.type === "loading" && "animate-rotation",
      )}
    >
      <Icon glyph={glyphs[props.type].glyph} tone={glyphs[props.type].tone} />
    </span>
  )
}
