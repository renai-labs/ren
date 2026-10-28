import { Initials } from "@ren/util/initials"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Avatar, AvatarFallback } from "@ren/ui/avatar"
import { Button, buttonVariants } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { PublicShell } from "@ren/ui/public-shell"
import { Spinner } from "@ren/ui/spinner"
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
          <Avatar className="size-14 rounded-xl">
            <AvatarFallback className="rounded-xl text-base">{Initials.of(props.organization.name)}</AvatarFallback>
          </Avatar>
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
            <Button variant="ghost" disabled={invitation.action !== "idle"} onClick={() => void invitation.decline()}>
              {invitation.action === "declining" ? "Declining…" : "No thanks, continue to Ren"}
            </Button>
          ) : (
            <Link to="/" className={buttonVariants({ variant: "ghost" })}>
              No thanks, return to homepage
            </Link>
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
        <Button className="w-full" onClick={() => void invitation.signInWithAnotherAccount()}>
          Sign in with another account
        </Button>
      )
    case "workspace-error":
      return (
        <Button className="w-full" onClick={() => void invitation.openWorkspace()}>
          Try opening the workspace again
        </Button>
      )
    case "error":
      return (
        <Button className="w-full" onClick={() => void invitation.join()}>
          Try again
        </Button>
      )
    case undefined:
      return (
        <Button
          className="w-full"
          disabled={invitation.action === "accepting"}
          onClick={() => void invitation.continueToJoin()}
        >
          {invitation.action === "accepting" ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          {invitation.action === "accepting" ? "Joining…" : "Continue to join"}
        </Button>
      )
  }
}

function FailureCallout(props: { failure: InvitationActions.Failure | undefined; userEmail: string | undefined }) {
  if (props.failure === undefined) return null
  const mismatch = props.failure.kind === "mismatch"
  return (
    <Alert>
      <Icon glyph="MailWarning" />
      <AlertTitle>
        {mismatch ? "This invitation is for another email address" : "We couldn’t finish joining the organization"}
      </AlertTitle>
      <AlertDescription>
        {props.failure.message === "" && mismatch
          ? `You’re signed in as ${props.userEmail ?? ""}. Sign in with the invited account to continue.`
          : props.failure.message}
      </AlertDescription>
    </Alert>
  )
}
