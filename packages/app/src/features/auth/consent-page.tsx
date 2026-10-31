import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Field, FieldLabel } from "@ren/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Skeleton } from "@ren/ui/skeleton"
import { Spinner } from "@ren/ui/spinner"
import { AuthLayout, FormError } from "../../components/auth-layout.js"
import { consentOrganizationHeader, oauthClientOptions, organizationsOptions, sessionOptions } from "../../lib/auth.js"
import { initials } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/consent")

const clientOf = (data: { client_name?: string; client_id?: string; logo_uri?: string } | undefined) => ({
  clientName: data?.client_name ?? data?.client_id ?? "This app",
  clientIcon: data?.logo_uri,
})

const activeOrganization = (
  session: { readonly session: { readonly activeOrganizationId?: string | null | undefined } } | null | undefined,
  organizations: ReadonlyArray<{ readonly id: string }>,
) => session?.session.activeOrganizationId ?? organizations.at(0)?.id ?? null

function ClientAvatar(props: { name: string; icon: string | undefined }) {
  return (
    <Avatar className="mx-auto size-14 rounded-xl">
      {props.icon ? <AvatarImage src={props.icon} alt="" /> : null}
      <AvatarFallback className="rounded-xl">{initials(props.name)}</AvatarFallback>
    </Avatar>
  )
}

function ConsentActions(props: {
  pending: boolean
  organizationId: string | null
  onAnswer: (accept: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button disabled={props.pending || !props.organizationId} onClick={() => props.onAnswer(true)}>
        {props.pending ? <Spinner data-icon="inline-start" /> : null}
        Allow
      </Button>
      <Button variant="ghost" disabled={props.pending} onClick={() => props.onAnswer(false)}>
        Deny
      </Button>
    </div>
  )
}

function OrganizationField(props: {
  organizations: ReadonlyArray<{ readonly id: string; readonly name: string }>
  value: string | null
  onChange: (organizationId: string | null) => void
  disabled: boolean
}) {
  if (props.organizations.length <= 1) return null
  return (
    <Field>
      <FieldLabel>Organization</FieldLabel>
      <Select
        items={props.organizations.map((each) => ({ value: each.id, label: each.name }))}
        value={props.value}
        onValueChange={(value) => props.onChange(value)}
        disabled={props.disabled}
      >
        <SelectTrigger className="h-10 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.organizations.map((each) => (
              <SelectItem key={each.id} value={each.id}>
                {each.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

export function ConsentPage() {
  const { auth } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const session = useQuery(sessionOptions(auth)).data
  const client = useQuery({ ...oauthClientOptions(auth, search.client_id ?? ""), enabled: Boolean(search.client_id) })
  const organizations = useQuery(organizationsOptions(auth)).data ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  const organizationId = chosen ?? activeOrganization(session, organizations)
  const answer = useMutation({
    mutationFn: async (accept: boolean) => {
      const result = await auth.oauth2.consent({
        accept,
        fetchOptions: { headers: { [consentOrganizationHeader]: organizationId ?? "" } },
      })
      if (result.error !== null) throw new Error(result.error.message ?? "Couldn’t send your answer. Try again.")
    },
  })
  const clientInfo = clientOf(client.data)
  const organizationName = organizations.find((each) => each.id === organizationId)?.name
  const pending = answer.isPending
  return (
    <AuthLayout
      title={
        client.isPending ? <Skeleton className="mx-auto h-6 w-48" /> : `Allow ${clientInfo.clientName} to use Ren?`
      }
      description={`${clientInfo.clientName} will act as you, ${session?.user.email ?? ""}, in ${organizationName ?? "the organization you choose"}. It can see and change your spaces, agents, chats and tasks.`}
    >
      <ClientAvatar name={clientInfo.clientName} icon={clientInfo.clientIcon} />
      <OrganizationField organizations={organizations} value={organizationId} onChange={setChosen} disabled={pending} />
      <FormError>{answer.error?.message ?? client.error?.message}</FormError>
      <ConsentActions pending={pending} organizationId={organizationId} onAnswer={answer.mutate} />
    </AuthLayout>
  )
}
