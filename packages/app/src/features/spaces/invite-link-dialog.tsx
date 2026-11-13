import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconLink } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { FieldDescription } from "@ren/ui/field"
import { toast } from "@ren/ui/sonner"
import { Loading } from "@ren/ui/loading"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { Copyable } from "../../components/copyable.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { Platform } from "../../platform/platform.js"
import { useSpace } from "./use-space.js"

export function InviteLinkDialog() {
  const { api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const space = useSpace()
  const me = useMe()
  const [open, setOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const link = useQuery({ ...api["space-invite-link"].get.queryOptions({ id: space.id }), enabled: open, staleTime: 0 })
  const reset = useMutation(api["space-invite-link"].reset.mutationOptions())
  const uses = link.data?.uses ?? 0
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="secondary" />}>
          <IconLink />
          Invite link
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite link</DialogTitle>
            <DialogDescription>Anyone who opens this link joins {space.name}.</DialogDescription>
          </DialogHeader>
          <Loading loading={link.isPending} label="Loading invite link">
            <Copyable
              id="space-invite-link"
              label="Link"
              value={`${platform.appUrl}/join/${link.data?.token ?? "sil_loading-placeholder-token"}`}
            />
            <div className="flex items-center justify-between gap-2">
              <FieldDescription>
                Only for people in {me.organization.name} · Used {uses} {uses === 1 ? "time" : "times"}
              </FieldDescription>
              <Button variant="ghost" disabled={!link.data} onClick={() => setResetting(true)}>
                Reset link
              </Button>
            </div>
          </Loading>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        confirmation={{
          title: "Reset invite link?",
          description: "The old link stops working. Anyone who has it needs the new one.",
          action: "Reset link",
          working: "Resetting…",
        }}
        onConfirm={() =>
          reset.mutateAsync(
            { id: space.id },
            {
              onSuccess: () => toast.success("Invite link reset"),
              onError: (error) => toast.error("Could not reset the link", { description: errorMessage(error) }),
            },
          )
        }
      />
    </>
  )
}
