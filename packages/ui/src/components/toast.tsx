export * as Toast from "./toast.js"

import { Toast } from "@base-ui/react/toast"
import { lazy, Suspense } from "react"
import type { ReactNode } from "react"

export const manager = Toast.createToastManager()

export type ToastType = "success" | "error" | "warning" | "info" | "loading"

export function Provider(props: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={manager} timeout={4000}>
      {props.children}
    </Toast.Provider>
  )
}

export type RegionProps = {
  placement?: "bottom-right" | "top-center"
  closeButton?: "visible" | "hidden"
}

const Viewport = lazy<(props: RegionProps) => ReactNode>(() =>
  import("../lib/toast-region.js").then(
    (module) => ({ default: module.ToastRegion }),
    () => ({ default: () => null }),
  ),
)

export function Region(props: RegionProps) {
  return (
    <Suspense fallback={null}>
      <Viewport {...props} />
    </Suspense>
  )
}
