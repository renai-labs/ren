import { Alert, AlertDescription } from "@ren/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Combobox } from "@ren/ui/combobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldTitle } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { toast } from "@ren/ui/toast"
import { Initials } from "@ren/util/initials"
import type { SpaceMemberInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { Spaces } from "./spaces.js"

export function AddSpaceMemberDialog(props: {
  spaceId: string
  organizationId: string
  members: ReadonlyArray<SpaceMemberInfo>
  onClose: () => void
}) {
  const context = RouterContext.useRouterContext()
  const organization = useQuery(Auth.organizationOptions(context.auth, props.organizationId))
  const create = useMutation(context.api["space-member"].create.mutationOptions())
  const [selected, setSelected] = useState<string | null>(null)
  const candidates = Spaces.candidates(props.members, organization.data)
  const candidate = candidates.find((each) => each.value === selected)
  const submit = () => {
    if (!candidate) return
    create.mutate(
      { payload: { spaceId: props.spaceId, ...candidate.target } },
      {
        onSuccess: () => {
          toast.add({ type: "success", title: candidate.addedMessage })
          props.onClose()
        },
      },
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Pick someone from the organization, or someone invited to it. Invited people join once they accept.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldTitle>Person</FieldTitle>
            <PersonPicker
              candidates={candidates}
              state={({ pending: "loading", error: "failed", success: "ready" } as const)[organization.status]}
              value={selected}
              onValueChange={setSelected}
            />
          </Field>
          {create.error ? (
            <Alert variant="destructive">
              <Icon glyph="AlertCircle" />
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-end">
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={create.isPending} />
            <FormActions.Submit
              pending={create.isPending}
              pendingLabel="Adding…"
              disabled={!candidate}
              onClick={submit}
            >
              Add member
            </FormActions.Submit>
          </FormActions.Root>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PersonPicker(props: {
  candidates: ReadonlyArray<Spaces.Candidate>
  state: "loading" | "failed" | "ready"
  value: string | null
  onValueChange: (value: string | null) => void
}) {
  return (
    <Combobox.Inline
      label="Person"
      state={props.state}
      searchPlaceholder="Search by name or email…"
      emptyMessage={
        props.candidates.length === 0 ? "Everyone in the organization is already in this space." : "No matches."
      }
      value={props.value}
      onValueChange={props.onValueChange}
      items={props.candidates.map((each) => ({
        value: each.value,
        label: each.label,
        description: each.description,
        keywords: [each.description],
        icon:
          "userId" in each.target ? (
            <Avatar size="sm" aria-hidden>
              {each.image ? <AvatarImage src={each.image} alt="" /> : null}
              <AvatarFallback>{Initials.of(each.label)}</AvatarFallback>
            </Avatar>
          ) : (
            <Icon glyph="Mail" />
          ),
      }))}
    />
  )
}
