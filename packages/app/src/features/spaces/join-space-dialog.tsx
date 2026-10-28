import type { SpaceInfo } from "@ren/client"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Combobox } from "@ren/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"

export function JoinSpaceDialog(props: { spaces: ReadonlyArray<SpaceInfo>; userId: string; onClose: () => void }) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const join = useMutation(context.api["space-member"].create.mutationOptions())
  const [selected, setSelected] = useState<string | null>(null)
  const joinable = props.spaces.filter((space) => space.canJoin)
  const space = joinable.find((each) => each.id === selected)
  const submit = () => {
    if (!space) return
    join.mutate(
      { payload: { spaceId: space.id, userId: props.userId } },
      {
        onSuccess: () => {
          toast.add({ type: "success", title: `Joined ${space.name}` })
          props.onClose()
          void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })
        },
      },
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !join.isPending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join space</DialogTitle>
          <DialogDescription>Choose a space in your organization to join.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Combobox.Inline
            label="Search spaces"
            searchPlaceholder="Search spaces…"
            emptyMessage={joinable.length === 0 ? "You’re already in every space" : "No matching spaces"}
            value={selected}
            onValueChange={setSelected}
            groups={[
              {
                value: "available",
                label: "Available spaces",
                items: joinable.map((each) => ({
                  value: each.id,
                  label: each.name,
                  description: each.description?.trim() || undefined,
                  icon: (
                    <span className="flex size-5 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                      <Icon glyph="Cube" />
                    </span>
                  ),
                })),
              },
            ]}
          />
          {join.error ? (
            <Alert variant="destructive">
              <Icon glyph="AlertCircle" />
              <AlertDescription>{join.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-end">
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={join.isPending} />
            <FormActions.Submit pending={join.isPending} pendingLabel="Joining…" disabled={!space} onClick={submit}>
              Join space
            </FormActions.Submit>
          </FormActions.Root>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
