import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import type { OrganizationInviteLinkPreview } from "@ren/client"
import { Avatar, AvatarFallback } from "@ren/ui/avatar"
import { Button, buttonVariants } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/sonner"
import { AuthLayout, FormError, GoogleButton } from "../../components/auth-layout.js"
import { AuthSkeleton } from "../../components/auth-skeleton.js"
import { sessionOptions } from "../../lib/auth.js"
import { errorMessage } from "../../lib/errors.js"
import { initials } from "../../lib/format.js"
import { openWorkspace } from "../../lib/invitation.js"
import { RouterContext } from "../../lib/router-context.js"

const unavailable = {
  expired: "This link has expired",
  revoked: "This link was revoked",
  invalid: "We couldn’t find this link",
} as const

const inviterLine = (preview: OrganizationInviteLinkPreview) =>
  preview.inviter ? `${preview.inviter.name} invited you` : "You’re invited"

function Summary(props: { organization: { name: string }; preview: OrganizationInviteLinkPreview }) {
  return (
    <>
      <Avatar className="mx-auto size-14 rounded-xl">
        <AvatarFallback className="rounded-xl text-lg">{initials(props.organization.name)}</AvatarFallback>
      </Avatar>
      {props.preview.spaces.length > 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          You’ll join {props.preview.spaces.map((space) => space.name).join(", ")}
        </p>
      ) : null}
    </>
  )
}

function JoinOrganization(props: {
  token: string
  organization: { id: string; name: string }
  preview: OrganizationInviteLinkPreview
}) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const accept = useMutation(context.api["organization-join-link"].accept.mutationOptions())
  const join = useMutation({
    mutationFn: async () => {
      const joined = await accept.mutateAsync({ token: props.token })
      const outcome = await openWorkspace(context, {
        organizationId: props.organization.id,
        redirect: `/spaces/${joined.spaceId}`,
      })
      if (outcome.kind !== "opened") throw new Error(outcome.message)
      return outcome.href
    },
    onSuccess: (href) => {
      toast.success(`Joined ${props.organization.name}`)
      return navigate({ href })
    },
  })
  return (
    <AuthLayout title={`Join ${props.organization.name}`} description={inviterLine(props.preview)}>
      <Summary organization={props.organization} preview={props.preview} />
      {join.error ? <FormError>{errorMessage(join.error)}</FormError> : null}
      <Button disabled={join.isPending || join.isSuccess} onClick={() => join.mutate()}>
        {join.isPending || join.isSuccess ? <Spinner data-icon="inline-start" /> : null}
        {join.error ? "Try again" : `Join ${props.organization.name}`}
      </Button>
    </AuthLayout>
  )
}

function SignedOut(props: { token: string; organization: { name: string }; preview: OrganizationInviteLinkPreview }) {
  const { auth } = RouterContext.useRouterContext()
  const destination = { redirect: `/join/${props.token}` }
  const remember = () => auth.$fetch("/join-link/remember", { method: "POST", body: { token: props.token } })
  return (
    <AuthLayout
      title={`Join ${props.organization.name}`}
      description={inviterLine(props.preview)}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" search={destination} onClick={() => void remember()}>
            Sign in
          </Link>
        </>
      }
      legal="signup"
    >
      <Summary organization={props.organization} preview={props.preview} />
      <div className="flex flex-col gap-2">
        <GoogleButton destination={destination} before={remember} />
        <Link
          to="/signup"
          search={destination}
          onClick={() => void remember()}
          className={buttonVariants({ variant: "secondary", className: "h-10 w-full" })}
        >
          Sign up with email
        </Link>
      </div>
    </AuthLayout>
  )
}

export function OrganizationJoinPage(props: { token: string }) {
  const { api, auth } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const session = useQuery(sessionOptions(auth)).data
  const preview = useQuery({
    ...api["organization-join-link"].preview.queryOptions({ token: props.token }),
    retry: false,
  })
  if (preview.isPending) return <AuthSkeleton title="Join an organization" fields={[]} action="Join" />
  if (preview.isError)
    return (
      <AuthLayout title="We couldn’t open this link" description="Check your connection and try again.">
        <Button onClick={() => void preview.refetch()}>Try again</Button>
      </AuthLayout>
    )
  const organization = preview.data.organization
  if (preview.data.state !== "pending" || !organization)
    return (
      <AuthLayout
        title={unavailable[preview.data.state === "pending" ? "invalid" : preview.data.state]}
        description={organization ? `Ask an admin of ${organization.name} for a new link.` : "Ask for a new link."}
      >
        <Button onClick={() => void navigate({ to: "/" })}>Open Ren</Button>
      </AuthLayout>
    )
  if (!session) return <SignedOut token={props.token} organization={organization} preview={preview.data} />
  return <JoinOrganization token={props.token} organization={organization} preview={preview.data} />
}
