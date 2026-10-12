import type { SpaceInfo } from "@ren/client"
import { Avatar } from "@ren/ui/avatar"
import { Combobox } from "@ren/ui/combobox"
import { Dialog } from "@ren/ui/dialog"
import { FormActions } from "@ren/ui/form-actions"
import { Notice } from "@ren/ui/notice"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"

export function JoinSpaceDialog(props: { spaces: ReadonlyArray<SpaceInfo>; userId: string; onClose: () => void }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const join = useMutation(context.api["space-member"].create.mutationOptions())
  const [selected, setSelected] = useState<string | null>(null)
  const joinable = props.spaces.filter((space) => !space.membershipId)
  const space = joinable.find((each) => each.id === selected)
  const submit = () => {
    if (!space) return
    join.mutate(
      { payload: { spaceId: space.id, userId: props.userId } },
      {
        onSuccess: () => {
          Toast.manager.add({ type: "success", title: `Joined ${space.name}` })
          props.onClose()
          void queryClient.invalidateQueries({ queryKey: context.api.space.list.queryKey() })
          void navigate({ to: "/sessions/spaces/$spaceId", params: { spaceId: space.id } })
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
      dismissal={join.isPending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Join space</Dialog.Title>
          <Dialog.Description>Choose a space in your organization to join.</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
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
                  icon: <Avatar.Root name={each.name} glyph="Cube" size="small" shape="square" decorative />,
                })),
              },
            ]}
          />
          <Notice tone="danger" placement="inline">
            {join.error?.message}
          </Notice>
        </Dialog.Body>
        <Dialog.Footer>
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={join.isPending} />
            <FormActions.Submit pending={join.isPending} pendingLabel="Joining…" disabled={!space} onClick={submit}>
              Join space
            </FormActions.Submit>
          </FormActions.Root>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
