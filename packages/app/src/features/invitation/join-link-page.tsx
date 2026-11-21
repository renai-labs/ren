import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { toast } from "@ren/ui/sonner"
import { OrganizationInviteLink } from "@ren/schema/organization-invite-link"
import { Avatar, AvatarFallback } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { AuthLayout } from "../../components/auth-layout.js"
import { AuthSkeleton } from "../../components/auth-skeleton.js"
import { errorMessage } from "../../lib/errors.js"
import { initials } from "../../lib/format.js"
import { openWorkspace } from "../../lib/invitation.js"
import { RouterContext } from "../../lib/router-context.js"
import { OrganizationJoinPage } from "./organization-join-page.js"

const route = getRouteApi("/join/$token")

interface Target {
  readonly organization: { readonly id: string; readonly name: string }
  readonly space: { readonly id: string; readonly name: string }
}

function useOpenSpace() {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  return async (target: Target) => {
    const outcome = await openWorkspace(context, {
      organizationId: target.organization.id,
      redirect: `/spaces/${target.space.id}`,
    })
    if (outcome.kind === "opened") await navigate({ href: outcome.href })
  }
}

function JoinSpace(props: { token: string; target: Target }) {
  const { api } = RouterContext.useRouterContext()
  const open = useOpenSpace()
  const accept = useMutation(api["join-link"].accept.mutationOptions())
  const working = accept.isPending || accept.isSuccess
  const join = () =>
    accept.mutate(
      { token: props.token },
      {
        onSuccess: () => {
          toast.success(`Joined ${props.target.space.name}`)
          void open(props.target)
        },
        onError: (error) => toast.error("Could not join the space", { description: errorMessage(error) }),
      },
    )
  return (
    <AuthLayout title={`Join ${props.target.space.name}`} description={props.target.organization.name}>
      <Avatar className="mx-auto size-14 rounded-xl">
        <AvatarFallback className="rounded-xl text-lg">{initials(props.target.space.name)}</AvatarFallback>
      </Avatar>
      <Button disabled={working} onClick={join}>
        {working ? <Spinner data-icon="inline-start" /> : null}
        Join
      </Button>
    </AuthLayout>
  )
}

function AlreadyInSpace(props: { target: Target }) {
  const open = useOpenSpace()
  return (
    <AuthLayout title={`You’re already in ${props.target.space.name}`} description={props.target.organization.name}>
      <Button onClick={() => void open(props.target)}>Open {props.target.space.name}</Button>
    </AuthLayout>
  )
}

function JoinSpaceLinkPage() {
  const { api } = RouterContext.useRouterContext()
  const params = route.useParams()
  const navigate = useNavigate()
  const preview = useQuery({ ...api["join-link"].preview.queryOptions({ token: params.token }), retry: false })
  const home = () => void navigate({ to: "/" })
  if (preview.isPending) return <AuthSkeleton title="Join a space" fields={[]} action="Join" />
  if (preview.isError)
    return (
      <AuthLayout title="We couldn’t open this link" description="Check your connection and try again.">
        <Button onClick={() => void preview.refetch()}>Try again</Button>
      </AuthLayout>
    )
  const organization = preview.data.organization
  const space = preview.data.space
  if (preview.data.state === "outside")
    return (
      <AuthLayout
        title={`This link is for people in ${organization?.name ?? "another organization"}`}
        description="Ask an admin to invite you."
      >
        <Button onClick={home}>Open Ren</Button>
      </AuthLayout>
    )
  if (!organization || !space)
    return (
      <AuthLayout title="This link no longer works" description="Ask a member of the space for a new link.">
        <Button onClick={home}>Open Ren</Button>
      </AuthLayout>
    )
  if (preview.data.state === "member") return <AlreadyInSpace target={{ organization, space }} />
  return <JoinSpace token={params.token} target={{ organization, space }} />
}

export function JoinLinkPage() {
  const params = route.useParams()
  return params.token.startsWith(OrganizationInviteLink.tokenPrefix) ? (
    <OrganizationJoinPage token={params.token} />
  ) : (
    <JoinSpaceLinkPage />
  )
}
