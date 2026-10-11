import type { ReactNode } from "react"

export function KeyboardKey(props: { children: ReactNode }) {
  return (
    <kbd
      data-slot="keyboard-key"
      className="inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-control border border-border-primary bg-fill-primary px-1 font-sans text-xs font-medium text-text-secondary [&_svg]:size-3"
    >
      {props.children}
    </kbd>
  )
}
