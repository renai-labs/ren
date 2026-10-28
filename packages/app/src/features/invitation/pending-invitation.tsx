import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { PublicShell } from "@ren/ui/public-shell"
import { Surface } from "@ren/ui/surface"
import { Text } from "@ren/ui/text"
import { Link } from "@tanstack/react-router"
import type { InvitationActions } from "./invitation-actions.js"
import { usePendingInvitation } from "./use-pending-invitation.js"
import type { PendingInvitationProps } from "./use-pending-invitation.js"

export function PendingInvitation(props: PendingInvitationProps & { organization: { name: string } }) {
  const invitation = usePendingInvitation(props)
  const authenticated = props.userEmail !== undefined
  return (
    <PublicShell.Centered>
      <div className="flex flex-col gap-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <Avatar.Root name={props.organization.name} size="extra-large" shape="square" decorative />
          <Text purpose="label" element="p">
            {props.organization.name}
          </Text>
        </div>
        <div className="flex flex-col gap-2">
          <Text purpose="title" alignment="center">
            You’ve been invited to join {props.organization.name}
          </Text>
          {props.inviter === undefined ? null : (
            <Text tone="secondary" alignment="center">
              Invited by {props.inviter}
            </Text>
          )}
        </div>
        <FailureCallout failure={invitation.failure} userEmail={props.userEmail} />
        <div className="flex flex-col gap-3">
          <PrimaryAction invitation={invitation} />
          {authenticated && invitation.failure?.kind !== "mismatch" ? (
            <Button appearance="link" disabled={invitation.action !== "idle"} onClick={() => void invitation.decline()}>
              {invitation.action === "declining" ? "Declining…" : "No thanks, continue to Ren"}
            </Button>
          ) : (
            <Button appearance="link" nativeButton={false} render={<Link to="/" />}>
              No thanks, return to homepage
            </Button>
          )}
        </div>
      </div>
    </PublicShell.Centered>
  )
}

function PrimaryAction(props: { invitation: ReturnType<typeof usePendingInvitation> }) {
  const invitation = props.invitation
  switch (invitation.failure?.kind) {
    case "mismatch":
      return (
        <Button appearance="primary" width="full" onClick={() => void invitation.signInWithAnotherAccount()}>
          Sign in with another account
        </Button>
      )
    case "workspace-error":
      return (
        <Button appearance="primary" width="full" onClick={() => void invitation.openWorkspace()}>
          Try opening the workspace again
        </Button>
      )
    case "error":
      return (
        <Button appearance="primary" width="full" onClick={() => void invitation.join()}>
          Try again
        </Button>
      )
    case undefined:
      return (
        <Button
          appearance="primary"
          width="full"
          disabled={invitation.action === "accepting"}
          onClick={() => void invitation.continueToJoin()}
        >
          {invitation.action === "accepting" ? "Joining…" : "Continue to join"}
        </Button>
      )
  }
}

function FailureCallout(props: { failure: InvitationActions.Failure | undefined; userEmail: string | undefined }) {
  if (props.failure === undefined) return null
  const mismatch = props.failure.kind === "mismatch"
  return (
    <Surface.Panel padding="medium" elevation="raised">
      <div className="flex gap-3 text-left">
        <span className="mt-1">
          <Icon glyph="MailWarning" tone="secondary" />
        </span>
        <div className="flex flex-col gap-1">
          <Text purpose="label" element="p">
            {mismatch ? "This invitation is for another email address" : "We couldn’t finish joining the organization"}
          </Text>
          <Text tone="secondary">
            {props.failure.message === "" && mismatch
              ? `You’re signed in as ${props.userEmail ?? ""}. Sign in with the invited account to continue.`
              : props.failure.message}
          </Text>
        </div>
      </div>
    </Surface.Panel>
  )
}
