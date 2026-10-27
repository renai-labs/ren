import { toast } from "sonner"
import { api, queryClient } from "@/lib/api"
import { auth } from "@/lib/auth"
import { resetSession } from "@/lib/chat"

export interface InvitationFailure {
  readonly kind: "mismatch" | "error" | "workspace-error"
  readonly id: string
  readonly message: string
}

export type InvitationOutcome = InvitationFailure | { readonly kind: "opened"; readonly href: string }

const failure = (kind: InvitationFailure["kind"], message: string): InvitationFailure => ({
  kind,
  id: crypto.randomUUID(),
  message,
})

export async function openWorkspace(input: { organizationId: string; redirect: string | undefined }) {
  const switched = await auth.organization.setActive({ organizationId: input.organizationId })
  if (switched.error) {
    const message = switched.error.message ?? "Your invitation was accepted, but the workspace could not open."
    toast.error("Couldn’t open workspace", { description: message })
    return failure("workspace-error", message)
  }
  resetSession()
  return { kind: "opened" as const, href: input.redirect ?? "/" }
}

export async function joinInvitation(input: {
  invitationId: string
  organizationId: string
  redirect: string | undefined
}): Promise<InvitationOutcome> {
  const accepted = await auth.organization.acceptInvitation({ invitationId: input.invitationId })
  if (!accepted.error) {
    toast.success("Joined organization")
    return openWorkspace(input)
  }
  if (
    accepted.error.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" ||
    accepted.error.message === "You are not the recipient of the invitation"
  )
    return failure("mismatch", "")
  await queryClient.invalidateQueries({ queryKey: api.invitation.preview.queryKey() })
  return failure("error", accepted.error.message ?? "The invitation could not be accepted.")
}
