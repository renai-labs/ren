import type { CredentialInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { Dialog } from "@ren/ui/dialog"
import { Icon } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { SearchField } from "@ren/ui/search-field"
import { Select } from "@ren/ui/select"
import { Toast } from "@ren/ui/toast"
import { Toolbar } from "@ren/ui/toolbar"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { PasteCredentialDialog } from "../../components/paste-credential-dialog.js"
import { Credentials } from "../../components/credentials.js"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { Profiles } from "../../components/profiles.js"
import { CredentialsTable } from "./credentials-table.js"
import { Owners } from "./owners.js"

export function SpaceCredentials(props: { spaceId: string; userId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const all = useQuery(context.api.credential.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }))
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }))

  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [copying, setCopying] = useState(false)
  const needle = useDeferredValue(query)
  const spaceList = spaces.data?.items ?? []
  const names = new Map(spaceList.map((space) => [space.id, space.name]))
  const items = all.data?.items ?? []
  const here = items.filter((item) => item.owner.kind === "space" && item.owner.spaceId === props.spaceId)
  const visible = here.filter((item) => Credentials.matches(item, needle))
  const elsewhere = items.filter(
    (item) =>
      item.owner.kind === "space" &&
      item.owner.spaceId !== props.spaceId &&
      Credentials.canCopy(item) &&
      !here.some((own) => own.label === item.label),
  )
  const refresh = () => queryClient.invalidateQueries({ queryKey: context.api.credential.list.queryKey() })
  const state = { pending: "loading", error: "failed", success: visible.length > 0 ? "ready" : "empty" } as const
  return (
    <>
      <Toolbar.Root>
        <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search keys" />
        {elsewhere.length > 0 ? (
          <Button
            appearance="secondary"
            size="small"
            leadingIcon={<Icon glyph="Copy" />}
            onClick={() => setCopying(true)}
          >
            Copy from a space
          </Button>
        ) : null}
        <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setCreating(true)}>
          Add key
        </Button>
      </Toolbar.Root>
      <SpaceProfiles spaceId={props.spaceId} />
      <CredentialsTable
        rows={visible}
        state={state[all.status]}
        query={needle.trim()}
        spaces={names}
        owners={Owners.options(spaceList)}
        userId={props.userId}
        emptyMessage="This space has no keys yet. Add one so its chats can reach an API."
        onChanged={refresh}
      />
      {creating ? (
        <PasteCredentialDialog
          title="Add key to this space"
          description="Every chat in this space can use it."
          owners={[{ value: `space:${props.spaceId}`, label: names.get(props.spaceId) ?? "This space" }]}
          userId={props.userId}
          submitLabel="Save key"
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      ) : null}
      {copying ? (
        <CopyFromSpaceDialog
          spaceId={props.spaceId}
          candidates={elsewhere}
          spaces={names}
          onClose={() => setCopying(false)}
          onCopied={refresh}
        />
      ) : null}
    </>
  )
}

// oxlint-disable-next-line ren/no-comments -- profiles.md §9 rule 1 (P12, P32): the profiles this space reaches, with their gaps; a new profile from here lists this space, and from a space with other members it is shared.
function SpaceProfiles(props: { spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const reach = useQuery({
    ...context.api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }),
    refetchOnWindowFocus: "always",
  })
  const members = useQuery(
    context.api["space-member"].list.queryOptions({ spaceId: props.spaceId, status: "active", page: 1, pageSize: 2 }),
  )
  const apps = useQuery(context.api.app.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }))
  const registry = useQuery(
    context.api["app-registry"].list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
  )
  const [opened, setOpened] = useState<{ readonly appId: string; readonly profileId?: string }>()
  const profiles = reach.data?.profiles ?? []
  const choices = [
    ...(apps.data?.items ?? []).map((app) => ({ value: app.id, label: app.name })),
    ...(registry.data?.items ?? []).map((app) => ({ value: app.id, label: app.name })),
  ]
  return (
    <>
      <List.Root label="App profiles in this space">
        <List.Section title="App profiles" appearance="eyebrow">
          {profiles.map((profile) => {
            const gaps = Profiles.gaps(profile).length
            return (
              <List.Item
                key={profile.id}
                title={`${profile.appSlug} · ${profile.name}`}
                description={gaps ? `${gaps} not connected` : "Connected"}
                trailing={
                  <Button
                    appearance="secondary"
                    size="small"
                    onClick={() => setOpened({ appId: profile.appId, profileId: profile.id })}
                  >
                    Open profile
                  </Button>
                }
              />
            )
          })}
        </List.Section>
      </List.Root>
      {choices.length > 0 ? (
        <Toolbar.Root>
          <Select.Root
            label="New profile for"
            size="small"
            options={choices}
            value={null}
            placeholder="New profile for an app"
            onValueChange={(appId) => setOpened({ appId })}
          />
        </Toolbar.Root>
      ) : null}
      {opened ? (
        <ProfileDialog
          appId={opened.appId}
          {...(opened.profileId && { profileId: opened.profileId })}
          from={{ spaceId: props.spaceId, members: members.data?.total ?? 1 }}
          onClose={() => setOpened(undefined)}
        />
      ) : null}
    </>
  )
}

function CopyFromSpaceDialog(props: {
  spaceId: string
  candidates: ReadonlyArray<CredentialInfo>
  spaces: ReadonlyMap<string, string>
  onClose: () => void
  onCopied: () => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const copy = useMutation(context.api.credential.copy.mutationOptions())
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={copy.isPending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Copy from a space</Dialog.Title>
          <Dialog.Description>
            A copy is a separate pasted key. Sign-ins cannot be copied; move them instead.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <List.Root label="Keys in other spaces">
            {props.candidates.map((candidate) => (
              <List.Item
                key={candidate.id}
                title={candidate.name ?? candidate.label}
                description={`${candidate.label} · ${Credentials.ownerLabel(candidate.owner, props.spaces, "")}`}
                trailing={
                  <Button
                    appearance="secondary"
                    size="small"
                    disabled={copy.isPending}
                    onClick={() =>
                      void copy
                        .mutateAsync({ id: candidate.id, owner: { kind: "space", spaceId: props.spaceId } })
                        .then(props.onCopied)
                        .then(() => Toast.manager.add({ type: "success", title: `${candidate.label} copied` }))
                        .catch(() => undefined)
                    }
                  >
                    Copy key
                  </Button>
                }
              />
            ))}
          </List.Root>
          <Notice tone="danger" placement="inline">
            {copy.error?.message}
          </Notice>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  )
}
