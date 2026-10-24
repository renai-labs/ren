import { Avatar } from "@ren/ui/avatar"
import { Combobox } from "@ren/ui/combobox"
import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { Notice } from "@ren/ui/notice"
import { Toast } from "@ren/ui/toast"
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
  onChanged: () => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const organization = useQuery(Auth.organizationOptions(context.auth, props.organizationId))
  const create = useMutation(context.api["space-member"].create.mutationOptions())
  const [selected, setSelected] = useState<string | null>(null)
  const reach = useQuery(context.api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }))
  const candidates = Spaces.candidates(props.members, organization.data)
  // oxlint-disable-next-line ren/no-comments -- profiles.md P42: a one-member space reaches its person's private profiles; once someone joins, they stop here.
  const stopping =
    props.members.filter((member) => member.status === "active").length === 1
      ? (reach.data?.profiles ?? []).filter((profile) => profile.kind === "private")
      : []
  const candidate = candidates.find((each) => each.value === selected)
  const submit = () => {
    if (!candidate) return
    create.mutate(
      { payload: { spaceId: props.spaceId, ...candidate.target } },
      {
        onSuccess: () => {
          Toast.manager.add({ type: "success", title: candidate.addedMessage })
          props.onClose()
          void props.onChanged()
        },
      },
    )
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={create.isPending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Add member</Dialog.Title>
          <Dialog.Description>
            Pick someone from the organization, or someone invited to it. Invited people join once they accept.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Field.Root label="Person">
            <PersonPicker
              candidates={candidates}
              state={({ pending: "loading", error: "failed", success: "ready" } as const)[organization.status]}
              value={selected}
              onValueChange={setSelected}
            />
          </Field.Root>
          {stopping.length > 0 ? (
            <Notice tone="warning" placement="inline">
              {`Chats here use private profiles: ${stopping.map((profile) => `${profile.appSlug} · ${profile.name}`).join(", ")}. Once someone joins, these profiles stop in this space.`}
            </Notice>
          ) : null}
          <Notice tone="danger" placement="inline">
            {create.error?.message}
          </Notice>
        </Dialog.Body>
        <Dialog.Footer>
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
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
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
            <Avatar.Root name={each.label} image={each.image} size="small" decorative />
          ) : (
            <Icon glyph="Mail" />
          ),
      }))}
    />
  )
}
