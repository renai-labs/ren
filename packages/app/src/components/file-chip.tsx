import type { ReactNode } from "react"
import { IconFile } from "@tabler/icons-react"

export function FileChip(props: { path: string; children: ReactNode }) {
  return (
    <span
      title={props.path}
      className="inline-flex items-baseline gap-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-[90%]"
    >
      <IconFile aria-hidden className="size-3.5 shrink-0 self-center" />
      {props.children}
    </span>
  )
}
