import type { ChannelMappingInfo } from "@ren/client"
import { IconCube, IconHash, IconLinkOff, IconPencil } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { ChannelMark } from "../../components/channel-mark.js"
import { PlaceName } from "../../components/place-name.js"
import { TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"

export function MappingsTable(props: {
  noun: string
  plural: string
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
            <TableEmpty columns={3}>
              {props.filtered
                ? `No matching ${props.plural}. Change the search or space filter.`
                : `No linked ${props.plural} yet. Add one so people can mention @Ren there.`}
            </TableEmpty>
          ) : null}
          {props.mappings.map((mapping) => (
            <MappingRow
              key={mapping.id}
              mapping={mapping}
              editable={!props.busy && props.editableSpaceIds.includes(mapping.space.id)}
              onEdit={() => props.onEdit(mapping.id)}
              onRemove={() => props.onRemove(mapping)}
            />
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function MappingRow(props: {
  mapping: ChannelMappingInfo
  editable: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const mapping = props.mapping
  return (
    <TableRow className="relative">
      <TableCell>
        <span className="flex items-center gap-2.5">
          {mapping.provider === "slack" ? (
            <IconHash className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChannelMark provider={mapping.provider} className="size-4 shrink-0 text-muted-foreground" />
          )}
          <Button
            variant="ghost"
            disabled={!props.editable}
            title={mapping.placeName}
            aria-label={`Edit ${mapping.placeName}`}
            onClick={props.onEdit}
            className="block h-auto min-w-0 justify-start truncate rounded-none border-0 p-0 text-left font-normal after:absolute after:inset-0 hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none"
          >
            {mapping.provider === "github" ? (
              <PlaceName provider={mapping.provider} name={mapping.placeName} />
            ) : (
              mapping.placeName
            )}
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
          {props.editable ? (
            <RowMenu
              label={`${mapping.placeName} actions`}
              items={[
                { label: "Edit", icon: IconPencil, onSelect: props.onEdit },
                { label: "Unlink", icon: IconLinkOff, onSelect: props.onRemove },
              ]}
            />
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  )
}
