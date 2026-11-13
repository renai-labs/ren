import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ren/ui/empty"

export function PagePlaceholder() {
  return (
    <Empty className="min-h-60 border">
      <EmptyHeader>
        <EmptyTitle>Nothing here yet</EmptyTitle>
        <EmptyDescription>This page is still being built.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
