import { useState } from "react"
import type { SpaceInfo } from "@ren/client"
import { IconChevronDown, IconCube, IconUser } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MenuSearch } from "@/components/ren/menu-search"


const isPersonal = (space: SpaceInfo) => space.memberCount === 1

export function WorkingIn(props: {
  spaces: ReadonlyArray<SpaceInfo>
  spaceId: string | undefined
  disabled?: boolean | undefined
  onChange: (spaceId: string) => void
}) {
  const [query, setQuery] = useState("")
  const spaceName = (spaceId: string | undefined) =>
    props.spaces.find((space) => space.id === spaceId)?.name ?? "Choose a space"
  const matches = props.spaces.filter((space) =>
    space.name.toLowerCase().includes(query.trim().toLowerCase())
  )
  const groups = [
    {
      label: "Personal",
      spaces: matches.filter(isPersonal),
    },
    {
      label: "Organization",
      spaces: matches.filter((space) => !isPersonal(space)),
    },
  ].filter((group) => group.spaces.length > 0)
  return (
    <DropdownMenu>
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
      <DropdownMenuContent side="top" align="start" className="w-64">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search" />
        {groups.map((group, index) => (
          <DropdownMenuGroup key={group.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.spaces.map((space) => (
              <DropdownMenuItem
                key={space.id}
                className={space.id === props.spaceId ? "font-medium" : ""}
                onClick={() => props.onChange(space.id)}
              >
                {isPersonal(space) ? <IconUser /> : <IconCube />}
                <span className="truncate">{space.name}</span>
                {isPersonal(space) ? (
                  <span className="ml-auto font-normal text-muted-foreground">
                    Only you
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
