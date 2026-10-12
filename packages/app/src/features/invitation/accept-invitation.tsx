import { Button } from "@ren/ui/button"
import { PublicShell } from "@ren/ui/public-shell"
import { Text } from "@ren/ui/text"
import { useQuery } from "@tanstack/react-query"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import type { InvitationActions } from "./invitation-actions.js"
import { InvitationStateCard } from "./invitation-state-card.js"
import { PendingInvitation } from "./pending-invitation.js"
import { UnavailableInvitation } from "./unavailable-invitation.js"

export function AcceptInvitation(props: {
  id: string
  redirect: string | undefined
  failure: InvitationActions.Failure | undefined
}) {
  const context = RouterContext.useRouterContext()
  const session = useQuery(Auth.sessionOptions(context.auth))
  const preview = useQuery({ ...context.api.invitation.preview.queryOptions({ id: props.id }), retry: false })
  const userEmail = session.data?.user.email
  const authenticated = userEmail !== undefined

  if (preview.isPending) {
    return (
      <PublicShell.Centered frame="none">
        <Text tone="secondary" element="div" alignment="center">
          Loading invitation…
        </Text>
      </PublicShell.Centered>
    )
  }
  if (preview.isError) {
    return (
      <InvitationStateCard
        glyph="AlertCircle"
        title="We couldn’t open this invitation"
        description="Check the link and try again. If the problem continues, ask the sender for a new invitation."
        action={
          <Button appearance="primary" width="full" onClick={() => void preview.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }
  const organization = preview.data.organization
  if (preview.data.state === "pending" && organization !== null) {
    return (
      <PendingInvitation
        key={props.failure?.id}
        id={props.id}
        redirect={props.redirect}
        failure={props.failure}
        organization={organization}
        inviter={preview.data.inviter?.name ?? preview.data.inviter?.email}
        userEmail={userEmail}
      />
    )
  }
  return (
    <UnavailableInvitation
      state={preview.data.state === "pending" ? "invalid" : preview.data.state}
      organizationId={organization?.id}
      authenticated={authenticated}
      redirect={props.redirect}
    />
  )
}
