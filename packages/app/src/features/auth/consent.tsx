import { Initials } from "@ren/util/initials"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Field, FieldLabel } from "@ren/ui/field"
import { Icon } from "@ren/ui/icon"
import { PublicShell } from "@ren/ui/public-shell"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { useMutation } from "@tanstack/react-query"
import { useId, useState } from "react"
import { Auth } from "../../lib/auth.js"

export function Consent(props: {
  client: { readonly name: string; readonly icon?: string | undefined }
  email: string
  organizations: ReadonlyArray<{ readonly id: string; readonly name: string }>
  activeOrganizationId: string | null
}) {
  const auth = Auth.useClient()
  const organizationFieldId = useId()
  const [organizationId, setOrganizationId] = useState(props.activeOrganizationId ?? props.organizations.at(0)?.id)
  const organization = props.organizations.find((candidate) => candidate.id === organizationId)
  const answer = useMutation({
    mutationFn: async (accept: boolean) => {
      const result = await auth.oauth2.consent({
        accept,
        fetchOptions: { headers: { [Auth.consentOrganizationHeader]: organizationId ?? "" } },
      })
      if (result.error !== null) throw new Error(result.error.message ?? "Couldn’t send your answer. Try again.")
    },
  })
  return (
    <PublicShell.Centered>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar className="size-14 rounded-xl">
            <AvatarImage src={props.client.icon} alt={props.client.name} className="rounded-xl" />
            <AvatarFallback className="rounded-xl text-base">{Initials.of(props.client.name)}</AvatarFallback>
          </Avatar>
          <Text purpose="title" alignment="center">
            Allow {props.client.name} to use Ren?
          </Text>
          <Text tone="secondary" alignment="center">
            {props.client.name} will act as you, {props.email}, in{" "}
            {organization === undefined ? "the organization you choose" : organization.name}. It can see and change your
            spaces, agents, chats and tasks.
          </Text>
        </div>
        {props.organizations.length > 1 ? (
          <Field>
            <FieldLabel htmlFor={organizationFieldId}>Organization</FieldLabel>
            <Select
              items={props.organizations.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              value={organizationId ?? null}
              onValueChange={(next) => setOrganizationId(next ?? undefined)}
              disabled={answer.isPending}
            >
              <SelectTrigger id={organizationFieldId} className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.organizations.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {answer.error === null ? null : (
          <Alert variant="destructive">
            <Icon glyph="AlertCircle" />
            <AlertDescription>{answer.error.message}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-3">
          <Button
            className="w-full"
            disabled={answer.isPending || organizationId === undefined}
            onClick={() => answer.mutate(true)}
          >
            {answer.isPending && answer.variables ? (
              <>
                <Spinner aria-hidden data-icon="inline-start" />
                Allowing…
              </>
            ) : (
              "Allow access"
            )}
          </Button>
          <Button variant="ghost" disabled={answer.isPending} onClick={() => answer.mutate(false)}>
            {answer.isPending && !answer.variables ? "Denying…" : "Deny"}
          </Button>
        </div>
      </div>
    </PublicShell.Centered>
  )
}
