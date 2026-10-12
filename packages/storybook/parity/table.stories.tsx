import type { StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import type { ComponentProps } from "react"
import { MenuItem } from "ren-v1/composites/menu"
import { Table } from "ren-v1/composites/table"
import type { TableColumn, TableSortDirection } from "ren-v1/composites/table"
import { Icon } from "../../ui/src/components/icon.js"

type Member = { id: string; name: string; email: string; role: string; seats: string }

const members: Member[] = [
  { id: "ada", name: "Ada Lovelace", email: "ada@example.com", role: "Owner", seats: "12" },
  { id: "grace", name: "Grace Hopper", email: "grace@example.com", role: "Admin", seats: "4" },
  { id: "alan", name: "Alan Turing", email: "alan@example.com", role: "Member", seats: "1" },
]

const columns = (sortable: boolean): TableColumn<Member>[] => [
  { key: "name", header: "Name", width: "fill", sortable, cell: (row) => row.name },
  { key: "email", header: "Email", width: "third", visibility: "wide-screens", cell: (row) => row.email },
  { key: "role", header: "Role", width: "medium", cell: (row) => row.role },
  { key: "seats", header: "Seats", width: "small", alignment: "end", cell: (row) => row.seats },
]

type Props = Omit<ComponentProps<typeof Table<Member>>, "columns" | "rows" | "rowKey">

function Members(props: { root: Props; sortable?: boolean }) {
  const [direction, setDirection] = useState<TableSortDirection>("ascending")
  const rows = props.sortable
    ? members.toSorted((left, right) =>
        direction === "ascending" ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name),
      )
    : members
  return (
    <Table
      {...props.root}
      columns={columns(props.sortable === true)}
      rows={rows}
      rowKey={(row) => row.id}
      sort={props.sortable ? { column: "name", direction, onChange: (_, next) => setDirection(next) } : undefined}
    />
  )
}

export default {
  title: "Parity/Table",
  component: Table,
  args: { caption: "Organization members" },
  render: (args: Props) => <Members root={args} />,
}

type Story = StoryObj<Props>

export const Default: Story = {}
export const Compact: Story = { args: { density: "compact" } }
export const Plain: Story = { args: { frame: "plain" } }
export const Sortable: Story = { render: (args) => <Members root={args} sortable /> }
export const RowActions: Story = {
  args: {
    rowActionsLabel: "Member actions",
    rowActions: (row: Member) =>
      row.role === "Owner" ? null : (
        <MenuItem tone="danger" icon={<Icon glyph="Trash2" />}>
          Remove
        </MenuItem>
      ),
  },
}
export const Activatable: Story = { args: { onRowActivate: () => undefined } }
export const ReservedRows: Story = { args: { reservedRows: 6 } }
export const Loading: Story = { args: { state: "loading" } }
export const Failed: Story = {
  args: { state: "failed", failureMessage: "Couldn’t load members.", onRetry: () => undefined },
}
export const Empty: Story = {
  render: () => (
    <Table
      columns={columns(false)}
      rows={[]}
      rowKey={(row) => row.id}
      emptyMessage="No members yet."
      emptyDescription="Invite someone to get started."
      emptyIcon={<Icon glyph="Users" size="medium" tone="secondary" />}
    />
  ),
}
