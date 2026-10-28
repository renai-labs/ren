import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { TableHead } from "@ren/ui/table"

export function SortableHead(props: {
  direction: "ascending" | "descending"
  onDirectionChange: (direction: "ascending" | "descending") => void
  children: string
}) {
  return (
    <TableHead className="px-4" aria-sort={props.direction}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 px-2 text-sm font-normal text-muted-foreground"
        onClick={() => props.onDirectionChange(props.direction === "ascending" ? "descending" : "ascending")}
      >
        {props.children}
        <Icon glyph={props.direction === "ascending" ? "ArrowUp" : "ArrowDown"} data-icon="inline-end" />
      </Button>
    </TableHead>
  )
}
