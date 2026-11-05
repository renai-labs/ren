import type { ChannelMappingInfo } from "@ren/client"
import { IconCube, IconHash, IconPencil, IconPlugOff } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { ChannelMark } from "../../components/channel-mark.js"
import { TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"

export function MappingsTable(props: {
  mappings: ReadonlyArray<ChannelMappingInfo>
  filtered: boolean
  editableSpaceIds: ReadonlyArray<string>
  busy: boolean
  onEdit: (id: string) => void
  onRemove: (mapping: ChannelMappingInfo) => void
}) {
  return (
    <TableCard>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-1/2">Mention @Ren in</TableHead>
            <TableHead>To work in space</TableHead>
            <TableHead className="w-15">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.mappings.length === 0 ? (
            <TableEmpty columns={3}>{props.filtered ? "No mappings match" : "No mappings"}</TableEmpty>
          ) : null}
          {props.mappings.map((mapping) => (
            <TableRow key={mapping.id} className="relative">
              <TableCell>
                <span className="flex items-center gap-2.5">
                  {mapping.provider === "slack" ? (
                    <IconHash className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChannelMark provider={mapping.provider} className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <Button
                    variant="ghost"
                    disabled={props.busy || !props.editableSpaceIds.includes(mapping.space.id)}
                    title={mapping.placeName}
                    aria-label={`Edit ${mapping.placeName} mapping`}
                    onClick={() => props.onEdit(mapping.id)}
                    className="block h-auto min-w-0 justify-start truncate rounded-none border-0 p-0 text-left font-normal after:absolute after:inset-0 hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none"
                  >
                    {mapping.placeName}
                  </Button>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <IconCube className="size-4 shrink-0" />
                  <span className="truncate" title={mapping.space.name}>
                    {mapping.space.name}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <span className="relative flex justify-end">
                  {props.busy || !props.editableSpaceIds.includes(mapping.space.id) ? null : (
                    <RowMenu
                      label={`${mapping.placeName} actions`}
                      items={[
                        { label: "Edit mapping", icon: IconPencil, onSelect: () => props.onEdit(mapping.id) },
                        { label: "Disconnect", icon: IconPlugOff, onSelect: () => props.onRemove(mapping) },
                      ]}
                    />
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}
