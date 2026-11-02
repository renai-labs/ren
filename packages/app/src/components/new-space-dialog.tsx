import { useMutation } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Textarea } from "@ren/ui/textarea"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/sonner"
import { formText } from "../lib/format.js"
import { errorMessage } from "../lib/errors.js"
import { RouterContext } from "../lib/router-context.js"

export function NewSpaceDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const create = useMutation(api.space.create.mutationOptions())
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            create.mutate(
              { name: formText(form, "name").trim(), description: formText(form, "description").trim() },
              {
                onSuccess: (space) => {
                  props.onOpenChange(false)
                  toast.success(`Created ${space.name}`)
                  void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })
                },
                onError: (error) => toast.error("Could not create the space", { description: errorMessage(error) }),
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>New space</DialogTitle>
            <DialogDescription>You join it as its first member.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="space-name">Name</FieldLabel>
              <Input id="space-name" name="name" required placeholder="Support team" />
            </Field>
            <Field>
              <FieldLabel htmlFor="space-description">
                Description
                <span className="text-xs font-normal text-muted-foreground">Optional</span>
              </FieldLabel>
              <Textarea
                id="space-description"
                name="description"
                placeholder="What does this space work on?"
                className="min-h-20"
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="sm:justify-end">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              Create space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
