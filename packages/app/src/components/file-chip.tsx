import type { ReactNode } from "react"

export function FileChip(props: { path: string; children: ReactNode }) {
  return (
    <span
      title={props.path}
      className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[90%] underline decoration-dotted underline-offset-2"
    >
      {props.children}
    </span>
  )
}
