import type { ComponentProps } from "react"

// oxlint-disable-next-line ren/no-comments -- A circular arrow around a bolt, at the size and weight of the Heroicons that the app uses.
export function AutomationIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden {...props}>
      <path d="M3.56 7.27A7 7 0 1 1 3 10" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
      <path
        d="M2.75 3.75 3.56 7.27 7.1 6.5"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11 5.5 7.5 10.8h2.3L9 14.5l3.5-5.3h-2.3L11 5.5Z" fill="currentColor" />
    </svg>
  )
}
