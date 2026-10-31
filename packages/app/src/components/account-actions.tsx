import type { AppProfileInfo, AppProfileItem } from "@ren/client"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { Platform } from "../platform/platform.js"
import { Apps } from "./apps.js"

const signsIn = (item: AppProfileItem) => "mcp" in item.item && (item.kind === "oauth" || item.kind === "provider")

// oxlint-disable-next-line ren/no-comments -- A sign-in opens in a new tab; the lists ask again when the window gets focus.
export function useSignIn() {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const connect = useMutation(context.api["credential-connect"].credential.connect.mutationOptions())
  const start = (profile: AppProfileInfo, item: AppProfileItem) => {
    if (!("mcp" in item.item)) return
    connect.mutate(
      { profileId: profile.id, item: item.item, ...(item.status !== "missing" && { reconnect: true }) },
      {
        onSuccess: (result) => {
          if ("redirectUrl" in result) platform.openExternal(result.redirectUrl)
        },
        onError: (error) =>
          toast.add({ type: "error", title: `Couldn’t connect ${item.name}`, description: error.message }),
      },
    )
  }
  return { start, pending: connect.isPending }
}

// oxlint-disable-next-line ren/no-comments -- ren-v1 connection row actions: Connect while something is missing, then Reconnect and Remove in the menu. Only a pasted key needs the profile dialog.
export function AccountActions(props: {
  profile: AppProfileInfo
  onOpen: () => void
  onRemove?: (() => void) | undefined
}) {
  const signIn = useSignIn()
  const [confirming, setConfirming] = useState(false)
  const remove = props.onRemove
  const items = props.profile.items.filter((item) => item.status !== "unavailable")
  const missing = items.filter((item) => !item.optional && item.status !== "ok")
  const connected = items.filter((item) => signsIn(item) && item.status === "ok")
  const pasted = items.some((item) => !signsIn(item))
  const first = missing.at(0)
  const connect = () =>
    missing.length === 1 && first && signsIn(first) ? signIn.start(props.profile, first) : props.onOpen()
  return (
    <>
      {first ? (
        <Button variant="outline" size="sm" disabled={signIn.pending} onClick={connect}>
          {signIn.pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          {missing.length === 1 ? "Connect" : `Connect ${missing.length}`}
        </Button>
      ) : null}
      {connected.length > 0 || pasted || props.onRemove ? (
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
            <Icon glyph="MoreHorizontal" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              {connected.map((item) => (
                <DropdownMenuItem key={item.label} onClick={() => signIn.start(props.profile, item)}>
                  <Icon glyph="RefreshCw" />
                  {connected.length === 1 ? "Reconnect" : `Reconnect ${item.name}`}
                </DropdownMenuItem>
              ))}
              {pasted ? (
                <DropdownMenuItem onClick={props.onOpen}>
                  <Icon glyph="KeyRound" />
                  Manage keys
                </DropdownMenuItem>
              ) : null}
              {props.onRemove ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => (Apps.isLastSpace(props.profile) ? setConfirming(true) : props.onRemove?.())}
                  >
                    <Icon glyph="Trash2" />
                    Remove from space
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {remove ? (
        <ConfirmationDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Remove ${props.profile.name}?`}
          description={Apps.lastSpaceWarning(props.profile)}
          confirmLabel="Remove and delete"
          tone="danger"
          onConfirm={remove}
        />
      ) : null}
    </>
  )
}
