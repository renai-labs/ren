import type { ReactNode } from "react"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export function EmptyState(props: { title?: string | undefined; children: ReactNode; action?: ReactNode | undefined }) {
  return (
    <Empty className="py-12">
      {props.title ? (
        <EmptyHeader>
          <EmptyTitle>{props.title}</EmptyTitle>
          <EmptyDescription>{props.children}</EmptyDescription>
        </EmptyHeader>
      ) : (
        <EmptyDescription>{props.children}</EmptyDescription>
      )}
      {props.action ? <EmptyContent>{props.action}</EmptyContent> : null}
    </Empty>
  )
}
