import { useState } from "react"
import type { ChannelInstallInfo, ChannelMappingInfo, ChannelTrigger, SpaceInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Choice } from "../../components/settings-shared.js"
import { RouterContext } from "../../lib/router-context.js"
import { Channels } from "../../lib/channels.js"
import { errorMessage } from "../../lib/errors.js"

export function MappingDialog(props: {
  install: ChannelInstallInfo
  place: { id: string; name: string }
  mapping: ChannelMappingInfo | undefined
  spaces: ReadonlyArray<SpaceInfo>
  triggers: ReadonlyArray<ChannelTrigger>
  onClose: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const save = useMutation(api["channel-mapping"].create.mutationOptions())
  const defaults = props.mapping
    ? Channels.settingsOf(props.mapping)
    : { spaceId: "", fallback: false, fallbackUserId: undefined, agentId: undefined, triggers: [] }
  const [spaceId, setSpaceId] = useState(defaults.spaceId)
  const [sender, setSender] = useState(defaults.fallback ? (defaults.fallbackUserId ?? "") : "")
  const [triggers, setTriggers] = useState(defaults.triggers)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose()
      }}
    >
      <DialogContent className="gap-6 p-6">
        <DialogHeader>
          <DialogTitle>{props.place.name}</DialogTitle>
          <DialogDescription>
            {props.mapping ? "Edit where mentions start work." : "Choose where mentions start work."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!spaceId) return
            save.mutate(
              {
                ...(props.mapping
                  ? Channels.settingsOf(props.mapping)
                  : { installId: props.install.id, place: props.place.id }),
                spaceId,
                agentId: defaults.spaceId === spaceId ? defaults.agentId : undefined,
                fallback: sender !== "",
                fallbackUserId: sender || undefined,
                triggers,
              },
              { onSuccess: props.onClose },
            )
          }}
        >
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel>Work in space</FieldLabel>
              <Choice
                label="Work in space"
                value={spaceId}
                options={[
                  { value: "", label: "Choose a space" },
                  ...props.spaces.map((space) => ({ value: space.id, label: space.name })),
                ]}
                className="w-full"
                disabled={save.isPending}
                onChange={(value) => {
                  setSpaceId(value)
                  setSender("")
                }}
              />
              {props.spaces.length === 0 ? (
                <FieldDescription>Join or create a space before adding a mapping.</FieldDescription>
              ) : null}
            </Field>
            <FallbackSender
              key={spaceId}
              spaceId={spaceId}
              value={sender}
              onChange={setSender}
              disabled={save.isPending}
            />
            {props.triggers.map((trigger) => (
              <Field key={trigger.id} orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor={`trigger-${trigger.id}`}>{trigger.title}</FieldLabel>
                  <FieldDescription>{trigger.description}</FieldDescription>
                </FieldContent>
                <Switch
                  id={`trigger-${trigger.id}`}
                  disabled={save.isPending}
                  checked={triggers.some((each) => each.id === trigger.id)}
                  onCheckedChange={(on) =>
                    setTriggers((previous) =>
                      on ? [...previous, { id: trigger.id }] : previous.filter((each) => each.id !== trigger.id),
                    )
                  }
                />
              </Field>
            ))}
            {save.isError ? <FieldError>{errorMessage(save.error, "Couldn’t save the mapping.")}</FieldError> : null}
          </FieldGroup>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" type="button" disabled={save.isPending} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!spaceId || save.isPending}>
              {save.isPending ? <Spinner data-icon="inline-start" /> : null}Save mapping
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FallbackSender(props: {
  spaceId: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { client } = RouterContext.useRouterContext()
  const members = useQuery(Channels.membersOptions(client, props.spaceId))
  return (
    <Field>
      <FieldLabel>Fallback sender</FieldLabel>
      <Choice
        label="Fallback sender"
        value={props.value}
        options={[
          { value: "", label: "Nobody" },
          ...(members.data ?? []).flatMap((member) =>
            member.status === "active" ? [{ value: member.userId, label: member.name || member.email }] : [],
          ),
        ]}
        onChange={props.onChange}
        className="w-full"
        disabled={!props.spaceId || members.isPending || members.isError || props.disabled}
      />
      <FieldDescription>Run as this person when Ren can’t match the sender to a member.</FieldDescription>
      {members.isError ? (
        <FieldError>
          {errorMessage(members.error, "Couldn’t load space members.")}
          <Button variant="outline" size="sm" onClick={() => void members.refetch()}>
            Retry loading members
          </Button>
        </FieldError>
      ) : null}
    </Field>
  )
}
