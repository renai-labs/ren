import { useState } from "react"
import type { SpaceInfo } from "@ren/client"
import { IconChevronDown, IconCube } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { MenuSearch } from "../../components/menu-search.js"

const isPersonal = (space: SpaceInfo) => space.kind === "private"

export function WorkingIn(props: {
  spaces: ReadonlyArray<SpaceInfo>
  spaceId: string | undefined
  disabled?: boolean | undefined
  onChange: (spaceId: string) => void
}) {
  const [query, setQuery] = useState("")
  const spaceName = (spaceId: string | undefined) =>
    props.spaces.find((space) => space.id === spaceId)?.name ?? "Choose a space"
  const matches = props.spaces.filter((space) => space.name.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = [
    {
      label: "Personal",
      spaces: matches.filter(isPersonal),
    },
    {
      label: "Shared",
      spaces: matches.filter((space) => !isPersonal(space)),
    },
  ].filter((group) => group.spaces.length > 0)
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setQuery("")
      }}
    >
      <DropdownMenuTrigger
        disabled={props.disabled}
        render={
          <Button
            variant="ghost"
            className="ml-1 self-start px-1 font-normal text-muted-foreground aria-expanded:bg-transparent"
            aria-label={`Destination: ${spaceName(props.spaceId)}`}
          />
        }
      >
        Working in
        <IconCube />
        <span className="text-foreground">{spaceName(props.spaceId)}</span>
        <IconChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search spaces…" />
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No spaces match “{query.trim()}”</p>
        ) : null}
        <DropdownMenuRadioGroup value={props.spaceId ?? ""} onValueChange={(next: string) => props.onChange(next)}>
          {groups.map((group, index) => (
            <DropdownMenuGroup key={group.label}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.spaces.map((space) => (
                <DropdownMenuRadioItem key={space.id} value={space.id} closeOnClick>
                  <IconCube />
                  <span className="min-w-0 flex-1 truncate">{space.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
