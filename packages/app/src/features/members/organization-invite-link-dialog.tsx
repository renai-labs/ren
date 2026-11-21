import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconLink } from "@tabler/icons-react"
import type { OrganizationInviteLinkInfo } from "@ren/client"
import { OrganizationInviteLink } from "@ren/schema/organization-invite-link"
import { Button } from "@ren/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { formatShortDate } from "@ren/ui/time"
import { Schema } from "effect"
import { SpacesField } from "../../components/spaces-field.js"
import { Copyable } from "../../components/copyable.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { Platform } from "../../platform/platform.js"

const expiries: ReadonlyArray<{ value: OrganizationInviteLink.Expiry; label: string }> = [
  { value: "1d", label: "In 1 day" },
  { value: "7d", label: "In 7 days" },
  { value: "30d", label: "In 30 days" },
]

const isExpiry = Schema.is(OrganizationInviteLink.Expiry)

function CreateStep(props: { onCreated: (link: OrganizationInviteLinkInfo) => void; onCancel: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const everySpace = useSpaces().spaces.filter((space) => space.kind === "shared")
  const older = (left: (typeof everySpace)[number], right: (typeof everySpace)[number]) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  const general = everySpace.reduce<(typeof everySpace)[number] | undefined>(
    (oldest, space) => (oldest && older(oldest, space) <= 0 ? oldest : space),
    undefined,
  )
  const spaces = everySpace.filter((space) => space.membershipId !== null || space.id === general?.id).toSorted(older)
  const locked = new Set(general ? [general.id] : [])
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [expiresIn, setExpiresIn] = useState<OrganizationInviteLink.Expiry>("7d")
  const create = useMutation(api["organization-invite-link"].create.mutationOptions())
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate(
          { spaceIds: [...picked].filter((id) => !locked.has(id)), expiresIn },
          { onSuccess: props.onCreated },
        )
      }}
    >
      <FieldGroup>
        <SpacesField spaces={spaces} picked={picked} onPick={setPicked} locked={locked} />
        <Field>
          <FieldLabel>Expires</FieldLabel>
          <Select
            items={expiries}
            value={expiresIn}
            onValueChange={(value) => {
              if (isExpiry(value)) setExpiresIn(value)
            }}
          >
            <SelectTrigger aria-label="Expires" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {expiries.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>After it expires, the link stops working. You can revoke it at any time.</FieldDescription>
        </Field>
        {create.error ? <FieldError>{errorMessage(create.error)}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Create link
        </Button>
      </DialogFooter>
    </form>
  )
}

function CopyStep(props: { link: OrganizationInviteLinkInfo; onDone: () => void }) {
  const platform = Platform.usePlatform()
  const me = useMe()
  return (
    <>
      <FieldGroup>
        <Copyable id="organization-invite-link" label="Link" value={`${platform.appUrl}/join/${props.link.token}`} />
        <FieldDescription>
          Joins {me.organization.name} · {props.link.spaces.map((space) => space.name).join(", ")} · Expires{" "}
          {formatShortDate(props.link.expiresAt)}
        </FieldDescription>
      </FieldGroup>
      <DialogFooter>
        <Button onClick={props.onDone}>Done</Button>
      </DialogFooter>
    </>
  )
}

export function OrganizationInviteLinkDialog() {
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<OrganizationInviteLinkInfo>()
  const close = () => {
    setOpen(false)
    setCreated(undefined)
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger render={<Button />}>
        <IconLink />
        Invite link
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "Copy your link" : "Invite link"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Share it in a team channel. Anyone who opens it can join."
              : "Anyone with the link joins as a member, and joins the spaces you pick."}
          </DialogDescription>
        </DialogHeader>
        {created ? <CopyStep link={created} onDone={close} /> : <CreateStep onCreated={setCreated} onCancel={close} />}
      </DialogContent>
    </Dialog>
  )
}
