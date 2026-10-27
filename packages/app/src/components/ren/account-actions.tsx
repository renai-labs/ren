import { useState } from "react"
import { IconBuilding, IconChevronDown, IconCube, IconDots, IconKey, IconRefresh, IconTrash } from "@tabler/icons-react"
import type { AppProfileInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog, type Confirmation } from "@/components/ren/confirm-dialog"
import { isLastSpace, lastSpaceWarning, signsIn } from "@/lib/apps"
import { useSignIn } from "@/hooks/use-sign-in"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage, profileQueries } from "@/lib/api"

type AppProfile = AppProfileInfo

export function AccountActions(props: {
  profile: AppProfile
  onOpen: () => void
  onRemove?: (() => void | Promise<unknown>) | undefined
}) {
  const [confirming, setConfirming] = useState<Confirmation>()
  const signIn = useSignIn()
  const startSignIn = (item: AppProfile["items"][number]) => signIn.start(props.profile.id, item)
  const items = props.profile.items.filter((item) => item.status !== "unavailable")
  const missing = items.filter((item) => !item.optional && item.status !== "ok")
  const connected = items.filter((item) => signsIn(item) && item.status === "ok")
  const pasted = items.some((item) => !signsIn(item))
  const first = missing.at(0)
  const remove = props.onRemove
  return (
    <>
      {first ? (
        <Button
          variant="outline"
          size="xs"
          className="h-6.5"
          disabled={signIn.pending}
          onClick={() => (missing.length === 1 && signsIn(first) ? startSignIn(first) : props.onOpen())}
        >
          {missing.length === 1 ? "Connect" : `Connect ${missing.length}`}
        </Button>
      ) : null}
      {connected.length > 0 || pasted || remove ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={`${props.profile.name} actions`}
              />
            }
          >
            <IconDots />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              {connected.map((item) => (
                <DropdownMenuItem key={item.label} onClick={() => startSignIn(item)}>
                  <IconRefresh />
                  {connected.length === 1 ? "Reconnect" : `Reconnect ${item.name}`}
                </DropdownMenuItem>
              ))}
              {pasted ? (
                <DropdownMenuItem onClick={props.onOpen}>
                  <IconKey />
                  Manage keys
                </DropdownMenuItem>
              ) : null}
              {remove ? (
                <>
                  {connected.length > 0 || pasted ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      isLastSpace(props.profile)
                        ? setConfirming({
                            title: `Remove ${props.profile.name}?`,
                            description: lastSpaceWarning(props.profile),
                            action: "Remove and delete",
                          })
                        : void remove()
                    }
                  >
                    <IconTrash />
                    Remove from space
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {confirming && remove ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(undefined)
          }}
          confirmation={confirming}
          onConfirm={remove}
        />
      ) : null}
    </>
  )
}

export function AccountAccess(props: { profile: AppProfile }) {
  const spaces = useSpaces().joined
  const access = useMutation({ ...api["app-profile"].access.mutationOptions(), meta: { invalidates: profileQueries } })
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
          render={
            <Button
              variant="outline"
              size="xs"
              className="h-6.5"
              aria-label={`Spaces that use ${props.profile.name}`}
            />
          }
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
            action: "Remove and delete",
          }}
          onConfirm={() => remove(confirming)}
        />
      ) : null}
    </>
  )
}
