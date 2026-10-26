import { AppProfile } from "@ren/schema/app-profile"
import { Pagination } from "@ren/schema/pagination"
import { Primitive } from "@ren/schema/primitive"
import { Checkbox } from "@ren/ui/checkbox"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { Notice } from "@ren/ui/notice"
import { RadioGroup } from "@ren/ui/radio-group"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  from?: { readonly spaceId: string; readonly members: number }
  onClose: () => void
}) {
  const [profileId, setProfileId] = useState(props.profileId)
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Content>
        {profileId ? (
          <ConnectAccount profileId={profileId} onClose={props.onClose} />
        ) : (
          <CreateProfile appId={props.appId} from={props.from} onCreated={setProfileId} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}

function CreateProfile(props: {
  appId: string
  from: { readonly spaceId: string; readonly members: number } | undefined
  onCreated: (id: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
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
      await queryClient.invalidateQueries({ queryKey: context.api["app-profile"].list.queryKey() })
      props.onCreated(created.id)
    },
  })
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>New profile</Dialog.Title>
        <Dialog.Description>
          A profile is one set of accounts for the app. The agent tells profiles apart by their name.
        </Dialog.Description>
      </Dialog.Header>
      <Form.Root form={form} arrangement="contents">
        <Dialog.Body>
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
                  <RadioGroup.Item value="shared" label="Shared" description="The spaces you pick use it." />
                  <RadioGroup.Item value="private" label="Private" description="Only your Personal Space uses it." />
                </field.RadioGroup>
              )}
            </form.AppField>
          ) : null}
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === "shared" ? (
                <Field.Root label="Spaces" {...(noSpace && listed.size === 0 && { error: "Pick at least one space." })}>
                  <span className="flex flex-col gap-2">
                    {(spaces.data?.items ?? []).map((space) => (
                      <Checkbox
                        key={space.id}
                        label={space.name}
                        labelVisibility="visible"
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
                    ))}
                  </span>
                </Field.Root>
              ) : null
            }
          </form.Subscribe>
          <Notice tone="danger" placement="inline">
            {create.error?.message}
          </Notice>
        </Dialog.Body>
        <Dialog.Footer>
          <form.SubmitButton pendingLabel="Creating…">Create profile</form.SubmitButton>
        </Dialog.Footer>
      </Form.Root>
    </>
  )
}
