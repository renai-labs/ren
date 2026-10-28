import { Button } from "@ren/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Spinner } from "@ren/ui/spinner"
import { TableCell, TableHead, TableRow } from "@ren/ui/table"

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

export function StateRow(props: {
  state: "loading" | "failed" | "ready"
  failureMessage: string
  emptyMessage: string
  emptyGlyph?: Glyph
  columns: number
}) {
  const glyph = props.state === "failed" ? "AlertCircle" : props.emptyGlyph
  return (
    <TableRow className="border-0 hover:bg-transparent">
      <TableCell colSpan={props.columns} className="whitespace-normal">
        {props.state === "loading" ? (
          <Empty>
            <EmptyMedia>
              <Spinner />
            </EmptyMedia>
          </Empty>
        ) : (
          <Empty {...(props.state === "failed" && { role: "alert" })}>
            <EmptyHeader>
              {glyph ? (
                <EmptyMedia variant="icon">
                  <Icon glyph={glyph} />
                </EmptyMedia>
              ) : null}
              <EmptyTitle>{props.state === "failed" ? props.failureMessage : props.emptyMessage}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </TableCell>
    </TableRow>
  )
}
