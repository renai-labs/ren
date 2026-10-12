import { Button } from "@ren/ui/button"
import { Link, useNavigate } from "@tanstack/react-router"
import { RouterContext } from "../../lib/router-context.js"
import { InvitationActions } from "./invitation-actions.js"
import { InvitationStateCard } from "./invitation-state-card.js"

export function UnavailableInvitation(props: {
  state: "expired" | "accepted" | "unavailable" | "invalid"
  organizationId: string | undefined
  authenticated: boolean
  redirect: string | undefined
}) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const organizationId = props.organizationId
  switch (props.state) {
    case "expired":
      return (
        <InvitationStateCard
          glyph="Clock3"
          title="This invitation has expired"
          description="Ask an organization admin to send you a new invitation."
        />
      )
    case "accepted":
      return (
        <InvitationStateCard
          glyph="CheckCircle2"
          title="This invitation has already been accepted"
          description="You can continue to Ren if you’ve already joined the organization."
          action={
            props.authenticated ? (
              <Button
                appearance="primary"
                width="full"
                onClick={() => {
                  if (organizationId === undefined) return
                  void InvitationActions.openWorkspace(context, { organizationId, redirect: props.redirect }).then(
                    (outcome) => (outcome.kind === "opened" ? navigate({ href: outcome.href }) : undefined),
                  )
                }}
              >
                Go to workspace
              </Button>
            ) : (
              <Button appearance="primary" width="full" render={<Link to="/login" />}>
                Sign in to Ren
              </Button>
            )
          }
        />
      )
    case "unavailable":
      return (
        <InvitationStateCard
          glyph="AlertCircle"
          title="This invitation is no longer available"
          description="The invitation may have been declined or canceled. Ask an organization admin for a new one."
        />
      )
    case "invalid":
      return (
        <InvitationStateCard
          glyph="AlertCircle"
          title="This invitation isn’t valid"
          description="The link may be incomplete or incorrect. Ask the sender to check it and try again."
        />
      )
  }
}
