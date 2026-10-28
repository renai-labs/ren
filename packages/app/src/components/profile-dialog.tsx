import type { SpaceKind } from "@ren/client"
import { AppProfile } from "@ren/schema/app-profile"
import { Pagination } from "@ren/schema/pagination"
import { Primitive } from "@ren/schema/primitive"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Checkbox } from "@ren/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { RadioGroupItem } from "@ren/ui/radio-group"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Schema } from "effect"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { ConnectAccount } from "./connect-account.js"
import { Profiles } from "./profiles.js"

const CreateForm = Schema.toStandardSchemaV1(
  Schema.Struct({ name: Primitive.Name, slug: AppProfile.Slug, kind: AppProfile.Kind }),
)

const page = { page: 1, pageSize: Pagination.maximumPageSize }

// oxlint-disable-next-line ren/no-comments -- profiles.md §9 (P12): name and slug, then shared or private, then spaces; the profile exists from the first save. Its items and dependencies follow in the same dialog.
export function ProfileDialog(props: {
  appId: string
  profileId?: string
  from?: { readonly spaceId: string; readonly kind: SpaceKind }
  onClose: () => void
}) {
  const [profileId, setProfileId] = useState(props.profileId)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      {profileId ? (
        <ConnectAccount profileId={profileId} onClose={props.onClose} />
      ) : (
        <CreateProfile appId={props.appId} from={props.from} onCreated={setProfileId} />
      )}
    </Dialog>
  )
}

function CreateProfile(props: {
  appId: string
  from: { readonly spaceId: string; readonly kind: SpaceKind } | undefined
  onCreated: (id: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const create = useMutation(context.api["app-profile"].create.mutationOptions())
  const spaces = useQuery(context.api.space.list.queryOptions(page))
  const kinds = Profiles.kinds(props.from)
  const [listed, setListed] = useState<ReadonlySet<string>>(() => new Set(props.from ? [props.from.spaceId] : []))
  const [noSpace, setNoSpace] = useState(false)
  const form = Form.useForm({
    defaultValues: { name: "", slug: "", kind: kinds.at(0) ?? "shared" },
    schema: CreateForm,
    onSubmit: async (value) => {
      if (value.kind === "shared" && listed.size === 0) return setNoSpace(true)
      const created = await create
        .mutateAsync({
          appId: props.appId,
          name: value.name,
          slug: value.slug,
          kind: value.kind,
          ...(value.kind === "shared" && { spaceIds: [...listed] }),
        })
        .catch(() => undefined)
      if (!created) return
      props.onCreated(created.id)
    },
  })
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New profile</DialogTitle>
        <DialogDescription>
          A profile is one set of accounts for the app. The agent tells profiles apart by their name.
        </DialogDescription>
      </DialogHeader>
      <Form.Root form={form} arrangement="contents">
        <div className="flex flex-col gap-4">
          <form.AppField
            name="name"
            listeners={{ onChange: (event) => form.setFieldValue("slug", Profiles.slugOf(event.value)) }}
          >
            {(field) => <field.TextField label="Name" placeholder="Acme client" />}
          </form.AppField>
          <form.AppField name="slug">
            {(field) => (
              <field.TextField
                label="Slug"
                description="It names the profile’s servers and keys, such as gmail__acme. It cannot change later."
                placeholder="acme"
              />
            )}
          </form.AppField>
          {kinds.length > 1 ? (
            <form.AppField name="kind">
              {(field) => (
                <field.RadioGroup label="Who uses it">
                  <Choice value="shared" title="Shared" description="The spaces you pick use it." />
                  <Choice value="private" title="Private" description="Only your private space uses it." />
                </field.RadioGroup>
              )}
            </form.AppField>
          ) : null}
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === "shared" ? (
                <FieldSet data-invalid={noSpace && listed.size === 0} className="gap-3">
                  <FieldLegend variant="label">Spaces</FieldLegend>
                  {(spaces.data?.items ?? []).map((space) => (
                    <Field key={space.id} orientation="horizontal">
                      <Checkbox
                        id={`profile-space-${space.id}`}
                        checked={listed.has(space.id)}
                        onCheckedChange={(checked) =>
                          setListed((current) => {
                            const next = new Set(current)
                            if (checked) next.add(space.id)
                            else next.delete(space.id)
                            return next
                          })
                        }
                      />
                      <FieldLabel htmlFor={`profile-space-${space.id}`} className="font-normal">
                        {space.name}
                      </FieldLabel>
                    </Field>
                  ))}
                  {noSpace && listed.size === 0 ? <FieldError>Pick at least one space.</FieldError> : null}
                </FieldSet>
              ) : null
            }
          </form.Subscribe>
          {create.error ? (
            <Alert variant="destructive">
              <Icon glyph="AlertCircle" />
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-end">
          <form.SubmitButton pendingLabel="Creating…">Create profile</form.SubmitButton>
        </DialogFooter>
      </Form.Root>
    </DialogContent>
  )
}

function Choice(props: { value: string; title: string; description: string }) {
  const id = `profile-kind-${props.value}`
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>{props.title}</FieldTitle>
          <FieldDescription className="text-xs">{props.description}</FieldDescription>
        </FieldContent>
        <RadioGroupItem value={props.value} id={id} />
      </Field>
    </FieldLabel>
  )
}
