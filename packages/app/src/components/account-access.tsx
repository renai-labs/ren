import type { AppProfileInfo, AppProfileSpaceShape, SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { Apps } from "./apps.js"

// oxlint-disable-next-line ren/no-comments -- profiles.md §10 (P19, P20): the server decides, through canAccess and canShareEverySpace.
export function AccountAccess(props: { profile: AppProfileInfo; spaces: ReadonlyArray<SpaceInfo>; userId: string }) {
  const context = RouterContext.useRouterContext()
  const access = useMutation(context.api["app-profile"].access.mutationOptions())
  const [confirming, setConfirming] = useState<string>()
  if (props.profile.kind === "private" || !props.profile.canAccess) return null
  const listed = new Set(props.profile.spaces.map((space) => space.id))
  const shapeOf = (space: SpaceInfo): AppProfileSpaceShape => {
    if (space.kind === "private") return space.ownerUserId === props.userId ? "ownPrivate" : "otherPrivate"
    return space.membershipId ? "joined" : "shared"
  }
  const offered = props.spaces.filter((space) =>
    (listed.has(space.id) ? props.profile.canRemove : props.profile.canAdd).includes(shapeOf(space)),
  )
  const change = (input: {
    readonly add?: Array<string>
    readonly remove?: Array<string>
    readonly allSpaces?: boolean
  }) =>
    access.mutate(
      { id: props.profile.id, ...input },
      {
        onError: (error) =>
          toast.add({ type: "error", title: "Couldn’t change the spaces", description: error.message }),
      },
    )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
                            disabled={access.isPending}
              aria-label={`Spaces that use ${props.profile.name}`}
            />
          }
        >
          {access.isPending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Spaces
          <Icon glyph="ChevronDown" data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {props.profile.canShareEverySpace ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={props.profile.allSpaces}
                  onCheckedChange={(checked) => change({ allSpaces: checked })}
                >
                  <Icon glyph="Building" />
                  Every space
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Spaces</DropdownMenuLabel>
            {offered.map((space) => (
              <DropdownMenuCheckboxItem
                key={space.id}
                checked={props.profile.allSpaces || listed.has(space.id)}
                disabled={props.profile.allSpaces}
                onCheckedChange={(checked) => {
                  if (checked) change({ add: [space.id] })
                  else if (Apps.isLastSpace(props.profile)) setConfirming(space.id)
                  else change({ remove: [space.id] })
                }}
              >
                <Icon glyph={space.kind === "private" ? "Lock" : "Cube"} />
                {space.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmationDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined)
        }}
        title={`Remove ${props.profile.name} from its last space?`}
        description={Apps.lastSpaceWarning(props.profile)}
        confirmLabel="Remove and delete"
        tone="danger"
        onConfirm={() => confirming && change({ remove: [confirming] })}
      />
    </>
  )
}
