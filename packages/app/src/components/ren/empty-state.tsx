import type { ReactNode } from "react"
import { Empty, EmptyContent, EmptyDescription } from "@/components/ui/empty"

export function EmptyState(props: { children: ReactNode; action?: ReactNode | undefined }) {
  return (
    <Empty className="py-12">
      <EmptyDescription>{props.children}</EmptyDescription>
      {props.action ? <EmptyContent>{props.action}</EmptyContent> : null}
    </Empty>
  )
}
