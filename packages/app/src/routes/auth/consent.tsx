import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { AuthLayout, FormError } from "@/components/ren/auth"
import {
  auth,
  consentOrganizationHeader,
  oauthClientOptions,
  organizationsOptions,
  sessionOptions,
} from "@/lib/auth"
import { initials } from "@/lib/format"

const route = getRouteApi("/consent")

function useConsentPage() {
  const search = route.useSearch()
  const session = useQuery(sessionOptions()).data
  const client = useQuery({ ...oauthClientOptions(search.client_id ?? ""), enabled: Boolean(search.client_id) })
  const organizations = useQuery(organizationsOptions()).data ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  const organizationId = chosen ?? session?.session.activeOrganizationId ?? organizations.at(0)?.id ?? null
  const answer = useMutation({
    mutationFn: async (accept: boolean) => {
      const result = await auth.oauth2.consent({
        accept,
        fetchOptions: { headers: { [consentOrganizationHeader]: organizationId ?? "" } },
      })
      if (result.error !== null) throw new Error(result.error.message ?? "Couldn’t send your answer. Try again.")
    },
  })
  return {
    loading: client.isPending,
    clientName: client.data?.client_name ?? client.data?.client_id ?? "This app",
    clientIcon: client.data?.logo_uri ?? undefined,
    email: session?.user.email ?? "",
    organizations,
    organizationId,
    organizationName: organizations.find((each) => each.id === organizationId)?.name,
    choose: setChosen,
    error: answer.error?.message ?? client.error?.message,
    pending: answer.isPending,
    answer: (accept: boolean) => answer.mutate(accept),
  }
}

export function ConsentPage() {
  const page = useConsentPage()
  return (
    <AuthLayout
      title={page.loading ? <Skeleton className="mx-auto h-6 w-48" /> : `Allow ${page.clientName} to use Ren?`}
      description={`${page.clientName} will act as you, ${page.email}, in ${page.organizationName ?? "the organization you choose"}. It can see and change your spaces, agents, chats and tasks.`}
    >
      <Avatar className="mx-auto size-14 rounded-xl">
        {page.clientIcon ? <AvatarImage src={page.clientIcon} alt="" /> : null}
        <AvatarFallback className="rounded-xl">{initials(page.clientName)}</AvatarFallback>
      </Avatar>
      {page.organizations.length > 1 ? (
        <Field>
          <FieldLabel>Organization</FieldLabel>
          <Select
            items={page.organizations.map((each) => ({ value: each.id, label: each.name }))}
            value={page.organizationId}
            onValueChange={(value) => page.choose(value)}
            disabled={page.pending}
          >
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {page.organizations.map((each) => (
                  <SelectItem key={each.id} value={each.id}>
                    {each.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <FormError>{page.error}</FormError>
      <div className="flex flex-col gap-2">
        <Button disabled={page.pending || !page.organizationId} onClick={() => page.answer(true)}>
          {page.pending ? <Spinner data-icon="inline-start" /> : null}
          Allow
        </Button>
        <Button variant="ghost" disabled={page.pending} onClick={() => page.answer(false)}>
          Deny
        </Button>
      </div>
    </AuthLayout>
  )
}
