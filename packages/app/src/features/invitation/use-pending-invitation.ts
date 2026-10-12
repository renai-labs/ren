import { Toast } from "@ren/ui/toast"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { InvitationActions } from "./invitation-actions.js"

export interface PendingInvitationProps {
  readonly id: string
  readonly redirect: string | undefined
  readonly failure: InvitationActions.Failure | undefined
  readonly organization: { readonly id: string }
  readonly inviter: string | undefined
  readonly userEmail: string | undefined
}

export function usePendingInvitation(props: PendingInvitationProps) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const [action, setAction] = useState<"idle" | "accepting" | "declining">("idle")
  const [failure, setFailure] = useState(props.failure)

  const join = async () => {
    setAction("accepting")
    setFailure(undefined)
    await navigate({
      to: "/invites/accept",
      search: { id: props.id, join: true, redirect: props.redirect },
      replace: true,
    })
  }

  return {
    action,
    failure,
    join,
    continueToJoin: async () => {
      if (!props.userEmail) {
        await navigate({ to: "/signup", search: { invitationId: props.id, redirect: props.redirect } })
        return
      }
      await join()
    },
    openWorkspace: async () => {
      const outcome = await InvitationActions.openWorkspace(context, {
        organizationId: props.organization.id,
        redirect: props.redirect,
      })
      if (outcome.kind === "opened") await navigate({ href: outcome.href })
      else setFailure(outcome)
    },
    signInWithAnotherAccount: async () => {
      const result = await context.auth.signOut()
      if (result.error) {
        setFailure({ kind: "mismatch", id: props.id, message: result.error.message ?? "Could not sign out." })
        return
      }
      context.queryClient.clear()
      await navigate({ to: "/login", search: { invitationId: props.id, redirect: props.redirect } })
    },
    decline: async () => {
      setAction("declining")
      const result = await context.auth.organization.rejectInvitation({ invitationId: props.id })
      if (result.error) {
        setAction("idle")
        Toast.manager.add({
          type: "error",
          title: "Couldn’t decline invitation",
          description: result.error.message ?? "Try again.",
        })
        return
      }
      context.queryClient.clear()
      await navigate({ href: props.redirect ?? "/" })
    },
  }
}
