import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconLinkOff, IconTrash } from "@tabler/icons-react"
import type { AppProfileInfo, Apps } from "@ren/client"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { ConfirmDialog, type Confirmation } from "./confirm-dialog.js"
import { RowMenu, type RowMenuItem } from "./row-menu.js"
import { toastRemoved } from "./space-removal.js"
import { lastSpaceWarning, listNames, listsSpace, reachedSpaces, statusOf, type CatalogApp } from "../lib/apps.js"
import { errorMessage } from "../lib/errors.js"
import { RouterContext } from "../lib/router-context.js"
import { useAppProfiles } from "../lib/use-app-profiles.js"

type AppProfile = AppProfileInfo
type From = Apps.From

function useRemoveFromSpace(profile: AppProfile, from: From | undefined) {
  const { api } = RouterContext.useRouterContext()
  const access = useMutation(api["app-profile"].access.mutationOptions())
  if (
    !from ||
    profile.kind === "private" ||
    profile.allSpaces ||
    !profile.spaces.some((space) => space.id === from.spaceId) ||
    !profile.canRemove.some((shape) => shape === "joined" || shape === "shared")
  )
    return undefined
  const others = reachedSpaces(profile).filter((name) => name !== from.name)
  return {
    label: `Remove from ${from.name}`,
    icon: IconLinkOff,
    destructive: false,
    confirm: {
      title: `Remove ${profile.name} from ${from.name}?`,
      description: others.length > 0 ? `It stays in ${listNames(others)}.` : lastSpaceWarning(profile),
      action: "Remove",
      tone: "default",
    },
    onSelect: () =>
      access.mutateAsync(
        { id: profile.id, remove: [from.spaceId] },
        {
          onSuccess: (info) =>
            toastRemoved(info, from.name, {
              onUndo: () => access.mutateAsync({ id: profile.id, add: [from.spaceId] }),
            }),
          onError: (error) =>
            toast.error(`Couldn’t remove ${profile.name}`, { description: errorMessage(error), duration: Infinity }),
        },
      ),
  } satisfies RowMenuItem
}

function useDeleteAccount(profile: AppProfile, app: Pick<CatalogApp, "mcps">, onDeleted: () => void) {
  const { api } = RouterContext.useRouterContext()
  const remove = useMutation(api["app-profile-reach"]["app-profile"].delete.mutationOptions())
  const others = useAppProfiles([profile.appId])
    .of(profile.appId)
    .filter((each) => each.id !== profile.id && each.kind === "shared")
  const unready =
    profile.kind === "shared" && !profile.allSpaces
      ? profile.spaces.filter(
          (space) =>
            statusOf(
              app,
              others.filter((each) => listsSpace(each, space.id)),
            ) === "missing",
        )
      : []
  const confirmation: Confirmation = {
    title: `Delete ${profile.name}?`,
    description:
      unready.length > 0
        ? `${listNames(unready.map((space) => space.name))} will show Not connected. You can’t undo this.`
        : "You can’t undo this.",
    action: "Delete",
    working: "Deleting…",
  }
  return {
    confirmation,
    remove: () =>
      remove.mutateAsync(
        { id: profile.id },
        {
          onSuccess: () => {
            toast.success(`${profile.name} deleted`)
            onDeleted()
          },
          onError: (error) =>
            toast.error(`Couldn’t delete ${profile.name}`, { description: errorMessage(error), duration: Infinity }),
        },
      ),
  }
}

export function AccountMenu(props: { profile: AppProfile; app: Pick<CatalogApp, "mcps">; from?: From | undefined }) {
  const removal = useRemoveFromSpace(props.profile, props.from)
  const deletion = useDeleteAccount(props.profile, props.app, () => undefined)
  return (
    <RowMenu
      label={`${props.profile.name} actions`}
      items={[
        ...(removal ? [removal] : []),
        { label: "Delete", icon: IconTrash, onSelect: deletion.remove, confirm: deletion.confirmation },
      ]}
      className="relative z-10 -my-1 flex text-muted-foreground"
    />
  )
}

export function DeleteAccount(props: { profile: AppProfile; app: Pick<CatalogApp, "mcps">; onDeleted: () => void }) {
  const deletion = useDeleteAccount(props.profile, props.app, props.onDeleted)
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-10 w-full text-muted-foreground hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        Delete account
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        confirmation={deletion.confirmation}
        onConfirm={deletion.remove}
      />
    </>
  )
}
