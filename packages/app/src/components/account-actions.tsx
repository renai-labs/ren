import { useState } from "react"
import { IconBuilding, IconChevronDown, IconCube } from "@tabler/icons-react"
import type { AppProfileInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { ConfirmDialog } from "./confirm-dialog.js"
import { lastSpaceWarning } from "../lib/apps.js"
import { useSpaces } from "../lib/use-spaces.js"
import { errorMessage } from "../lib/errors.js"
import { RouterContext } from "../lib/router-context.js"

type AppProfile = AppProfileInfo

export function AccountAccess(props: { profile: AppProfile }) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces().joined
  const access = useMutation({ ...api["app-profile"].access.mutationOptions() })
  const [confirming, setConfirming] = useState<string>()
  const allSpaces = props.profile.allSpaces
  const listed = new Set(props.profile.spaces.map((space) => space.id))
  if (props.profile.kind === "private") return null
  if (!props.profile.canAccess) return null
  const change = (input: { add?: string[]; remove?: string[]; allSpaces?: boolean }) =>
    access.mutateAsync(
      { id: props.profile.id, ...input },
      { onError: (error) => toast.error("Couldn’t change the spaces", { description: errorMessage(error) }) },
    )
  const remove = (spaceId: string) => change({ remove: [spaceId] })
  const setAllSpaces = (checked: boolean) => void change({ allSpaces: checked })
  const last = !allSpaces && listed.size === 1
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" aria-label={`Spaces that use ${props.profile.name}`} />}
        >
          Spaces
          <IconChevronDown className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {props.profile.canShareEverySpace ? (
            <>
              <DropdownMenuCheckboxItem checked={allSpaces} onCheckedChange={setAllSpaces}>
                <IconBuilding />
                Every space
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Spaces</DropdownMenuLabel>
            {spaces.map((space) => (
              <DropdownMenuCheckboxItem
                key={space.id}
                checked={allSpaces || listed.has(space.id)}
                disabled={allSpaces}
                onCheckedChange={(checked) => {
                  if (checked) void change({ add: [space.id] })
                  else if (last) setConfirming(space.id)
                  else void remove(space.id)
                }}
              >
                <IconCube />
                {space.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(undefined)
          }}
          confirmation={{
            title: `Remove ${props.profile.name} from its last space?`,
            description: lastSpaceWarning(props.profile),
            action: "Remove from space",
          }}
          onConfirm={() => remove(confirming)}
        />
      ) : null}
    </>
  )
}
