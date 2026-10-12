export * as InvitationActions from "./invitation-actions.js"

import { Toast } from "@ren/ui/toast"
import type { QueryClient } from "@tanstack/react-query"
import type { Auth } from "../../lib/auth.js"
import type { Runtime } from "../../lib/runtime.js"

export interface Failure {
  readonly kind: "mismatch" | "error" | "workspace-error"
  readonly id: string
  readonly message: string
}

export type Outcome = Failure | { readonly kind: "opened"; readonly href: string }

const failure = (kind: Failure["kind"], message: string): Failure => ({ kind, id: crypto.randomUUID(), message })

interface Context {
  readonly auth: Auth.Client
  readonly api: Runtime.Context["api"]
  readonly queryClient: QueryClient
}

export async function openWorkspace(
  context: Context,
  input: { organizationId: string; redirect: string | undefined },
): Promise<Outcome> {
  const switched = await context.auth.organization.setActive({ organizationId: input.organizationId })
  if (switched.error) {
    const message = switched.error.message ?? "Your invitation was accepted, but the workspace could not open."
    Toast.manager.add({ type: "error", title: "Couldn’t open workspace", description: message })
    return failure("workspace-error", message)
  }
  context.queryClient.clear()
  return { kind: "opened", href: input.redirect ?? "/" }
}

export async function join(
  context: Context,
  input: { invitationId: string; organizationId: string; redirect: string | undefined },
): Promise<Outcome> {
  const accepted = await context.auth.organization.acceptInvitation({ invitationId: input.invitationId })
  if (!accepted.error) {
    Toast.manager.add({ type: "success", title: "Joined organization" })
    return openWorkspace(context, input)
  }
  if (
    accepted.error.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" ||
    accepted.error.message === "You are not the recipient of the invitation"
  ) {
    return failure("mismatch", "")
  }
  await context.queryClient.invalidateQueries({ queryKey: context.api.invitation.preview.queryKey() })
  return failure("error", accepted.error.message ?? "The invitation could not be accepted.")
}
