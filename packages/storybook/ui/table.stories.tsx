import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import type { ComponentProps } from "react"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Table } from "@ren/ui/table"
import type { TableSortDirection } from "@ren/ui/table"

const members = [
  { id: "ada", name: "Ada Lovelace", email: "ada@example.com", role: "Owner", seats: "12" },
  { id: "grace", name: "Grace Hopper", email: "grace@example.com", role: "Admin", seats: "4" },
  { id: "alan", name: "Alan Turing", email: "alan@example.com", role: "Member", seats: "1" },
]

function Members(props: {
  root: ComponentProps<typeof Table.Root>
  sortable?: boolean
  actions?: boolean
  activatable?: boolean
}) {
  const [direction, setDirection] = useState<TableSortDirection>("ascending")
  const rows = props.sortable
    ? members.toSorted((left, right) =>
        direction === "ascending" ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name),
      )
    : members
  return (
    <Table.Root {...props.root}>
      <Table.Header>
        {props.sortable ? (
          <Table.SortableHeaderCell direction={direction} onSortChange={setDirection}>
            Name
          </Table.SortableHeaderCell>
        ) : (
          <Table.HeaderCell>Name</Table.HeaderCell>
        )}
        <Table.HeaderCell width="third" visibility="wide-screens">
          Email
        </Table.HeaderCell>
        <Table.HeaderCell width="medium">Role</Table.HeaderCell>
        <Table.HeaderCell width="small" alignment="end">
          Seats
        </Table.HeaderCell>
        {props.actions ? <Table.RowActionsHeaderCell /> : null}
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.id} onActivate={props.activatable ? () => undefined : undefined}>
            <Table.Cell>{row.name}</Table.Cell>
            <Table.Cell visibility="wide-screens">{row.email}</Table.Cell>
            <Table.Cell>{row.role}</Table.Cell>
            <Table.Cell alignment="end">{row.seats}</Table.Cell>
            {props.actions ? (
              <Table.RowActions label="Member actions">
                {row.role === "Owner" ? null : (
                  <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />}>
                    Remove
                  </Menu.Item>
                )}
              </Table.RowActions>
            ) : null}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}

const meta = {
  component: Table.Root,
  args: { caption: "Organization members", children: null },
  render: (args) => <Members root={args} />,
} satisfies Meta<typeof Table.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Compact: Story = { args: { density: "compact" } }
export const Plain: Story = { args: { frame: "plain" } }
export const Sortable: Story = { render: (args) => <Members root={args} sortable /> }
export const RowActions: Story = { render: (args) => <Members root={args} actions /> }
export const Activatable: Story = { render: (args) => <Members root={args} activatable /> }
export const ReservedRows: Story = { args: { reservedRows: 6 } }
export const Loading: Story = { args: { state: "loading" } }
export const Failed: Story = {
  args: { state: "failed", failureMessage: "Couldn’t load members.", onRetry: () => undefined },
}
export const Empty: Story = {
  args: {
    state: "empty",
    emptyMessage: "No members yet.",
    emptyDescription: "Invite someone to get started.",
    emptyIcon: <Icon glyph="Users" size="medium" tone="secondary" />,
  },
}
