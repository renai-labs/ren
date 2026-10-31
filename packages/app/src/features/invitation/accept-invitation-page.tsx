import { useState } from "react"
import type { InvitationPreview } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { IconMailExclamation } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Avatar, AvatarFallback } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { AuthLayout } from "../../components/auth-layout.js"
import { sessionOptions } from "../../lib/auth.js"
import { resetSession } from "../../lib/chat.js"
import { initials } from "../../lib/format.js"
import { openWorkspace, type InvitationFailure } from "../../lib/invitation.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/invites/accept")

const unavailableCopy = {
  expired: { title: "This invitation has expired", description: "Ask an organization admin to send you a new one." },
  accepted: { title: "This invitation was already used", description: "Open Ren to continue." },
  unavailable: { title: "This invitation isn’t available", description: "It may have been revoked." },
  invalid: { title: "This invitation isn’t valid", description: "Check the link, or ask for a new invitation." },
}

function invitationOf(data: InvitationPreview | undefined) {
  if (!data)
    return {
      organization: null,
      pending: false,
      unavailable: unavailableCopy.invalid,
      organizationName: "",
      inviter: undefined,
    }
  const organization = data.organization ?? null
  return {
    organization,
    pending: data.state === "pending" && organization !== null,
    unavailable: unavailableCopy[data.state === "pending" ? "invalid" : data.state],
    organizationName: organization?.name ?? "",
    inviter: data.inviter?.name ?? data.inviter?.email,
  }
}

function FailureAlert(props: { failure: InvitationFailure; signedInAs: string | undefined }) {
  const mismatch = props.failure.kind === "mismatch"
  return (
    <Alert>
      <IconMailExclamation />
      <AlertTitle>
        {mismatch ? "This invitation is for another email address" : "We couldn’t finish joining the organization"}
      </AlertTitle>
      <AlertDescription>
        {mismatch
          ? `You’re signed in as ${props.signedInAs ?? ""}. Sign in with the invited account to continue.`
          : props.failure.message}
      </AlertDescription>
    </Alert>
  )
}

function joinLabel(state: { readonly failure: InvitationFailure | undefined; readonly action: string }) {
  if (state.failure) return "Try again"
  if (state.action === "accepting") return "Joining…"
  return "Continue to join"
}

function JoinAction(props: {
  failure: InvitationFailure | undefined
  action: "idle" | "accepting" | "declining"
  onJoin: () => Promise<void>
  onOpenWorkspace: () => Promise<void>
  onSignInWithAnotherAccount: () => Promise<void>
}) {
  if (props.failure?.kind === "mismatch")
    return <Button onClick={() => void props.onSignInWithAnotherAccount()}>Sign in with another account</Button>
  if (props.failure?.kind === "workspace-error")
    return <Button onClick={() => void props.onOpenWorkspace()}>Try opening the workspace again</Button>
  return (
    <Button disabled={props.action !== "idle"} onClick={() => void props.onJoin()}>
      {props.action === "accepting" ? <Spinner data-icon="inline-start" /> : null}
      {joinLabel(props)}
    </Button>
  )
}

function DeclineAction(props: {
  signedIn: boolean
  action: "idle" | "accepting" | "declining"
  onDecline: () => Promise<void>
  onHome: () => void
}) {
  if (!props.signedIn)
    return (
      <Button variant="ghost" onClick={props.onHome}>
        No thanks, return to homepage
      </Button>
    )
  return (
    <Button variant="ghost" disabled={props.action !== "idle"} onClick={() => void props.onDecline()}>
      {props.action === "declining" ? "Declining…" : "No thanks, continue to Ren"}
    </Button>
  )
}

export function AcceptInvitationPage() {
  const context = RouterContext.useRouterContext()
  const { api, auth, queryClient } = context
  const search = route.useSearch()
  const loaded = route.useLoaderData()
  const navigate = useNavigate()
  const id = search.id ?? ""
  const session = useQuery(sessionOptions(auth)).data
  const preview = useQuery({ ...api.invitation.preview.queryOptions({ id }), enabled: id !== "", retry: false })
  const [action, setAction] = useState<"idle" | "accepting" | "declining">("idle")
  const [failure, setFailure] = useState<InvitationFailure | undefined>(loaded.failure)
  const invitation = invitationOf(preview.data)
  const organization = invitation.organization
  const signedInAs = session?.user.email
  const join = async () => {
    setFailure(undefined)
    if (!session) {
      await navigate({ to: "/signup", search: { invitationId: id, redirect: search.redirect } })
      return
    }
    setAction("accepting")
    await navigate({ to: "/invites/accept", search: { id, join: true, redirect: search.redirect }, replace: true })
    setAction("idle")
  }
  const reopenWorkspace = async () => {
    if (!organization) return
    const outcome = await openWorkspace(context, { organizationId: organization.id, redirect: search.redirect })
    if (outcome.kind === "opened") await navigate({ href: outcome.href })
    else setFailure(outcome)
  }
  const signInWithAnotherAccount = async () => {
    await auth.signOut()
    context.platform.analytics?.reset()
    resetSession(queryClient)
    await navigate({ to: "/login", search: { invitationId: id, redirect: search.redirect } })
  }
  const decline = async () => {
    setAction("declining")
    const result = await auth.organization.rejectInvitation({ invitationId: id })
    if (result.error) {
      setAction("idle")
      toast.error("Couldn’t decline invitation", { description: result.error.message ?? "Try again." })
      return
    }
    resetSession(queryClient)
    await navigate({ href: search.redirect ?? "/" })
  }
  const home = () => void navigate({ to: "/" })
  if (preview.isPending && id !== "")
    return (
      <AuthLayout title="Loading invitation…" description="">
        {null}
      </AuthLayout>
    )
  if (preview.isError || id === "")
    return (
      <AuthLayout
        title="We couldn’t open this invitation"
        description="Check the link and try again. If the problem continues, ask the sender for a new invitation."
      >
        <Button onClick={() => void preview.refetch()}>Try again</Button>
      </AuthLayout>
    )
  if (!invitation.pending)
    return (
      <AuthLayout title={invitation.unavailable.title} description={invitation.unavailable.description}>
        <Button onClick={home}>Open Ren</Button>
      </AuthLayout>
    )
  return (
    <AuthLayout
      title={`You’ve been invited to join ${invitation.organizationName}`}
      description={invitation.inviter ? `Invited by ${invitation.inviter}` : ""}
    >
      <Avatar className="mx-auto size-14 rounded-xl">
        <AvatarFallback className="rounded-xl text-lg">{initials(invitation.organizationName)}</AvatarFallback>
      </Avatar>
      {failure ? <FailureAlert failure={failure} signedInAs={signedInAs} /> : null}
      <div className="flex flex-col gap-2">
        <JoinAction
          failure={failure}
          action={action}
          onJoin={join}
          onOpenWorkspace={reopenWorkspace}
          onSignInWithAnotherAccount={signInWithAnotherAccount}
        />
        <DeclineAction
          signedIn={signedInAs !== undefined && failure?.kind !== "mismatch"}
          action={action}
          onDecline={decline}
          onHome={home}
        />
      </div>
    </AuthLayout>
  )
}
