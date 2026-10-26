import type { AppProfileInfo, SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { Apps } from "./apps.js"

// oxlint-disable-next-line ren/no-comments -- profiles.md §10 (P19, P20): the server decides, through canAccess and canShareEverySpace.
export function AccountAccess(props: { profile: AppProfileInfo; spaces: ReadonlyArray<SpaceInfo> }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const access = useMutation(context.api["app-profile"].access.mutationOptions())
  const [confirming, setConfirming] = useState<string>()
  if (props.profile.kind === "private" || !props.profile.canAccess) return null
  const listed = new Set(props.profile.spaces.map((space) => space.id))
  const change = (input: {
    readonly add?: Array<string>
    readonly remove?: Array<string>
    readonly allSpaces?: boolean
  }) =>
    access.mutate(
      { id: props.profile.id, ...input },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: context.api["app-profile"].list.queryKey() })
          void queryClient.invalidateQueries({ queryKey: context.api["app-profile-reach"].space.profiles.queryKey() })
        },
        onError: (error) =>
          Toast.manager.add({ type: "error", title: "Couldn’t change the spaces", description: error.message }),
      },
    )
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              appearance="secondary"
              size="small"
              pending={access.isPending}
              trailingIcon={<Icon glyph="ChevronDown" />}
              aria-label={`Spaces that use ${props.profile.name}`}
            >
              Spaces
            </Button>
          }
        />
        <Menu.Popup alignment="end" width="medium">
          {props.profile.canShareEverySpace ? (
            <>
              <Menu.CheckboxItem
                checked={props.profile.allSpaces}
                icon={<Icon glyph="Building" />}
                onCheckedChange={(checked) => change({ allSpaces: checked })}
              >
                Every space
              </Menu.CheckboxItem>
              <Menu.Separator />
            </>
          ) : null}
          <Menu.Section label="Spaces">
            {props.spaces.map((space) => (
              <Menu.CheckboxItem
                key={space.id}
                checked={props.profile.allSpaces || listed.has(space.id)}
                disabled={props.profile.allSpaces}
                icon={<Icon glyph="Cube" />}
                onCheckedChange={(checked) => {
                  if (checked) change({ add: [space.id] })
                  else if (Apps.isLastSpace(props.profile)) setConfirming(space.id)
                  else change({ remove: [space.id] })
                }}
              >
                {space.name}
              </Menu.CheckboxItem>
            ))}
          </Menu.Section>
        </Menu.Popup>
      </Menu.Root>
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
