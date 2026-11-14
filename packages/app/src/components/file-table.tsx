import type { ReactNode } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { cn } from "cn"

type Column = { readonly label: string; readonly className: string }

export const rowLink =
  "min-w-0 truncate outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"

export function FileTable(props: { columns: ReadonlyArray<Column>; children: ReactNode }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-12 px-3">Name</TableHead>
          {props.columns.map((column) => (
            <TableHead key={column.label} className={cn("h-12 px-3 max-md:hidden", column.className)}>
              {column.label}
            </TableHead>
          ))}
          <TableHead className="h-12 w-14" />
        </TableRow>
      </TableHeader>
      <TableBody className="[&_tr:last-child]:border-b">{props.children}</TableBody>
    </Table>
  )
}

export function FileRow(props: {
  media: ReactNode
  name: ReactNode
  badge?: ReactNode | undefined
  cells: ReadonlyArray<ReactNode>
  menu?: ReactNode | undefined
  className?: string | undefined
}) {
  return (
    <TableRow className={cn("relative cursor-pointer", props.className)}>
      <TableCell className="h-12 px-3">
        <span className="flex min-w-0 items-center gap-4">
          <span className="flex w-6 shrink-0 justify-center text-muted-foreground [&_svg]:size-5">{props.media}</span>
          {props.name}
          {props.badge}
        </span>
      </TableCell>
      {props.cells.map((cell, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- a cell's position is its column
        <TableCell key={index} className="h-12 truncate px-3 text-muted-foreground tabular-nums max-md:hidden">
          {cell}
        </TableCell>
      ))}
      <TableCell className="h-12 px-2">
        <span className="relative flex justify-end">{props.menu}</span>
      </TableCell>
    </TableRow>
  )
}

export function FileTableSample(props: { columns: ReadonlyArray<Column>; count: number }) {
  return (
    <FileTable columns={props.columns}>
      {Array.from({ length: props.count }, (_, index) => (
        <FileRow
          key={index}
          media={<span className="size-5 rounded-sm bg-muted" />}
          name={<span>Loading file name</span>}
          cells={props.columns.map(() => "Loading")}
        />
      ))}
    </FileTable>
  )
}
