import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconClock } from "@tabler/icons-react"
import type { SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@ren/ui/field"
import { SpaceJoinRequest } from "@ren/schema/space-join-request"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/sonner"
import { Textarea } from "@ren/ui/textarea"
import { errorMessage } from "../../lib/errors.js"
import { formText } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"

function AskToJoinDialog(props: { space: SpaceInfo; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { api } = RouterContext.useRouterContext()
  const space = props.space
  const create = useMutation({
    ...api["space-join-request"].create.mutationOptions(),
    onSuccess: () => {
      props.onOpenChange(false)
      toast.success(`Asked to join ${space.name}`)
    },
    onError: (error) => toast.error("Could not send the request", { description: errorMessage(error) }),
  })
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const note = formText(new FormData(event.currentTarget), "note").trim()
            create.mutate({ spaceId: space.id, ...(note ? { note } : {}) })
          }}
        >
          <DialogHeader>
            <DialogTitle>Ask to join {space.name}</DialogTitle>
            <DialogDescription>A member of the space can approve or decline your request.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="join-request-note">
                Note
                <span className="text-xs font-normal text-muted-foreground">Optional</span>
              </FieldLabel>
              <Textarea
                id="join-request-note"
                name="note"
                maxLength={SpaceJoinRequest.maximumNoteLength}
                placeholder="Why would you like to join?"
                className="min-h-20"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="sm:justify-end">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AskToJoin(props: { space: SpaceInfo; size?: "default" | "sm" | undefined }) {
  const { api } = RouterContext.useRouterContext()
  const space = props.space
  const [open, setOpen] = useState(false)
  const cancel = useMutation(api["space-join-request"].cancel.mutationOptions())
  if (space.joinRequestId) {
    const requestId = space.joinRequestId
    return (
      <span className="flex items-center gap-1">
        <span className="flex items-center gap-1 text-foreground">
          <IconClock className="size-3.5" />
          Requested
        </span>
        <Button
          variant="ghost"
          size={props.size}
          disabled={cancel.isPending}
          onClick={() =>
            cancel.mutate(
              { id: requestId },
              {
                onSuccess: () => toast.success(`Request to join ${space.name} cancelled`),
                onError: (error) => toast.error("Could not cancel the request", { description: errorMessage(error) }),
              },
            )
          }
        >
          {cancel.isPending ? <Spinner data-icon="inline-start" /> : null}
          Cancel
        </Button>
      </span>
    )
  }
  if (!space.canRequestJoin) return null
  return (
    <>
      <Button size={props.size} variant="outline" onClick={() => setOpen(true)}>
        Ask to join
      </Button>
      <AskToJoinDialog space={space} open={open} onOpenChange={setOpen} />
    </>
  )
}
