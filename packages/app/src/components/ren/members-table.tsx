import { useState, type ReactNode } from "react"
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Confirmation } from "@/components/ren/confirm-dialog"
import { TableCard, TableEmpty } from "@/components/ren/page"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { RowMenu } from "@/components/ren/row-menu"

export type MemberRow = {
  id: string
  name: string
  email: string
  image?: string | undefined
  you?: boolean | undefined
}

export function MembersTable<Row extends MemberRow>(props: {
  rows: Row[]
  column: { heading: string; cell: (row: Row) => ReactNode }
  remove: (row: Row) => Confirmation | undefined
  onRemove?: ((row: Row) => Promise<unknown>) | undefined
  empty: ReactNode
  stale?: boolean | undefined
}) {
  const [descending, setDescending] = useState(false)
  return (
    <TableCard className={props.stale ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 px-2 text-sm font-normal text-muted-foreground"
                onClick={() => setDescending((current) => !current)}
              >
                Name
                {descending ? <IconArrowDown /> : <IconArrowUp />}
              </Button>
            </TableHead>
            <TableHead className="w-1/3">Email</TableHead>
            <TableHead className="w-1/4">{props.column.heading}</TableHead>
            <TableHead className="w-15" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.length === 0 ? <TableEmpty columns={5}>{props.empty}</TableEmpty> : null}
          {props.rows
            .toSorted(
              (a, b) => a.name.localeCompare(b.name) * (descending ? -1 : 1)
            )
            .map((row) => {
              const confirmation = props.remove(row)
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-3">
                      <PersonAvatar name={row.name} image={row.image} />
                      <span className="truncate">{row.name}</span>
                      {row.you ? (
                        <span className="text-xs text-muted-foreground">
                          You
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="truncate" title={row.email}>
                    {row.email}
                  </TableCell>
                  <TableCell>{props.column.cell(row)}</TableCell>
                  <TableCell>
                    {confirmation ? (
                      <RowMenu
                        label={`${row.name} actions`}
                        items={[
                          {
                            label: "Remove",
                            confirm: confirmation,
                            onSelect: () => props.onRemove?.(row),
                          },
                        ]}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
        </TableBody>
      </Table>
    </TableCard>
  )
}
