import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Field } from "@ren/ui/field"
import { Notice } from "@ren/ui/notice"
import { PublicShell } from "@ren/ui/public-shell"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"

export function Consent(props: {
  client: { readonly name: string; readonly icon?: string | undefined }
  email: string
  organizations: ReadonlyArray<{ readonly id: string; readonly name: string }>
  activeOrganizationId: string | null
}) {
  const auth = Auth.useClient()
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
          <Avatar.Root name={props.client.name} image={props.client.icon} size="extra-large" shape="square" />
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
          <Field.Root label="Organization">
            <Select.Root
              label="Organization"
              value={organizationId ?? null}
              width="full"
              options={props.organizations.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              onValueChange={setOrganizationId}
              disabled={answer.isPending}
            />
          </Field.Root>
        ) : null}
        {answer.error === null ? null : (
          <Notice tone="danger" placement="inline">
            {answer.error.message}
          </Notice>
        )}
        <div className="flex flex-col gap-3">
          <Button
            appearance="primary"
            width="full"
            disabled={answer.isPending || organizationId === undefined}
            onClick={() => answer.mutate(true)}
          >
            {answer.isPending && answer.variables ? "Allowing…" : "Allow access"}
          </Button>
          <Button appearance="link" disabled={answer.isPending} onClick={() => answer.mutate(false)}>
            {answer.isPending && !answer.variables ? "Denying…" : "Deny"}
          </Button>
        </div>
      </div>
    </PublicShell.Centered>
  )
}
