import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { IconMailExclamation } from "@tabler/icons-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { AuthLayout } from "@/components/ren/auth"
import { api } from "@/lib/api"
import { auth, sessionOptions } from "@/lib/auth"
import { resetSession } from "@/lib/chat"
import { initials } from "@/lib/format"
import { openWorkspace, type InvitationFailure } from "@/lib/invitation"

const route = getRouteApi("/invites/accept")

const unavailableCopy = {
  expired: { title: "This invitation has expired", description: "Ask an organization admin to send you a new one." },
  accepted: { title: "This invitation was already used", description: "Open Ren to continue." },
  unavailable: { title: "This invitation isn’t available", description: "It may have been revoked." },
  invalid: { title: "This invitation isn’t valid", description: "Check the link, or ask for a new invitation." },
}

function useAcceptInvitationPage() {
  const search = route.useSearch()
  const loaded = route.useLoaderData()
  const navigate = useNavigate()
  const id = search.id ?? ""
  const session = useQuery(sessionOptions()).data
  const preview = useQuery({ ...api.invitation.preview.queryOptions({ id }), enabled: id !== "", retry: false })
  const [action, setAction] = useState<"idle" | "accepting" | "declining">("idle")
  const [failure, setFailure] = useState<InvitationFailure | undefined>(loaded.failure)
  const organization = preview.data?.organization ?? null
  const state = preview.data?.state
  return {
    loading: preview.isPending && id !== "",
    failed: preview.isError || id === "",
    retry: () => void preview.refetch(),
    pending: state === "pending" && organization !== null,
    unavailable: unavailableCopy[state === "pending" || !state ? "invalid" : state],
    organizationName: organization?.name ?? "",
    inviter: preview.data?.inviter?.name ?? preview.data?.inviter?.email,
    signedInAs: session?.user.email,
    action,
    failure,
    join: async () => {
      setFailure(undefined)
      if (!session) {
        await navigate({ to: "/signup", search: { invitationId: id, redirect: search.redirect } })
        return
      }
      setAction("accepting")
      await navigate({ to: "/invites/accept", search: { id, join: true, redirect: search.redirect }, replace: true })
      setAction("idle")
    },
    openWorkspace: async () => {
      if (!organization) return
      const outcome = await openWorkspace({ organizationId: organization.id, redirect: search.redirect })
      if (outcome.kind === "opened") await navigate({ href: outcome.href })
      else setFailure(outcome)
    },
    signInWithAnotherAccount: async () => {
      await auth.signOut()
      resetSession()
      await navigate({ to: "/login", search: { invitationId: id, redirect: search.redirect } })
    },
    decline: async () => {
      setAction("declining")
      const result = await auth.organization.rejectInvitation({ invitationId: id })
      if (result.error) {
        setAction("idle")
        toast.error("Couldn’t decline invitation", { description: result.error.message ?? "Try again." })
        return
      }
      resetSession()
      await navigate({ href: search.redirect ?? "/" })
    },
    home: () => void navigate({ to: "/" }),
  }
}

export function AcceptInvitationPage() {
  const page = useAcceptInvitationPage()
  if (page.loading)
    return (
      <AuthLayout title="Loading invitation…" description="">
        {null}
      </AuthLayout>
    )
  if (page.failed)
    return (
      <AuthLayout
        title="We couldn’t open this invitation"
        description="Check the link and try again. If the problem continues, ask the sender for a new invitation."
      >
        <Button onClick={page.retry}>Try again</Button>
      </AuthLayout>
    )
  if (!page.pending)
    return (
      <AuthLayout title={page.unavailable.title} description={page.unavailable.description}>
        <Button onClick={page.home}>Open Ren</Button>
      </AuthLayout>
    )
  const mismatch = page.failure?.kind === "mismatch"
  return (
    <AuthLayout
      title={`You’ve been invited to join ${page.organizationName}`}
      description={page.inviter ? `Invited by ${page.inviter}` : ""}
    >
      <Avatar className="mx-auto size-14 rounded-xl">
        <AvatarFallback className="rounded-xl text-lg">{initials(page.organizationName)}</AvatarFallback>
      </Avatar>
      {page.failure ? (
        <Alert>
          <IconMailExclamation />
          <AlertTitle>
            {mismatch ? "This invitation is for another email address" : "We couldn’t finish joining the organization"}
          </AlertTitle>
          <AlertDescription>
            {mismatch
              ? `You’re signed in as ${page.signedInAs ?? ""}. Sign in with the invited account to continue.`
              : page.failure.message}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        {mismatch ? (
          <Button onClick={() => void page.signInWithAnotherAccount()}>Sign in with another account</Button>
        ) : page.failure?.kind === "workspace-error" ? (
          <Button onClick={() => void page.openWorkspace()}>Try opening the workspace again</Button>
        ) : (
          <Button disabled={page.action !== "idle"} onClick={() => void page.join()}>
            {page.action === "accepting" ? <Spinner data-icon="inline-start" /> : null}
            {page.failure ? "Try again" : page.action === "accepting" ? "Joining…" : "Continue to join"}
          </Button>
        )}
        {page.signedInAs && !mismatch ? (
          <Button variant="ghost" disabled={page.action !== "idle"} onClick={() => void page.decline()}>
            {page.action === "declining" ? "Declining…" : "No thanks, continue to Ren"}
          </Button>
        ) : (
          <Button variant="ghost" onClick={page.home}>
            No thanks, return to homepage
          </Button>
        )}
      </div>
    </AuthLayout>
  )
}
