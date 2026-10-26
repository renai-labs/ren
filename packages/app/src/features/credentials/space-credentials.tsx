import type { CredentialInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { Dialog } from "@ren/ui/dialog"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Menu } from "@ren/ui/menu"
import { List } from "@ren/ui/list"
import { Notice } from "@ren/ui/notice"
import { SearchField } from "@ren/ui/search-field"
import { Toast } from "@ren/ui/toast"
import { Toolbar } from "@ren/ui/toolbar"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { PasteCredentialDialog } from "../../components/paste-credential-dialog.js"
import { Credentials } from "../../components/credentials.js"
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
        <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search credentials" />
        {elsewhere.length > 0 ? (
          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton appearance="primary" size="small" label="Add or copy a credential">
                  <Icon glyph="Plus" />
                </IconButton>
              }
            />
            <Menu.Popup alignment="end" width="small">
              <Menu.Item icon={<Icon glyph="Plus" />} onSelect={() => setCreating(true)}>
                Add credential
              </Menu.Item>
              <Menu.Item icon={<Icon glyph="Copy" />} onSelect={() => setCopying(true)}>
                Copy from a space
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        ) : (
          <Button
            appearance="primary"
            size="small"
            leadingIcon={<Icon glyph="Plus" />}
            onClick={() => setCreating(true)}
          >
            Add credential
          </Button>
        )}
      </Toolbar.Root>
      <CredentialsTable
        rows={visible}
        state={state[all.status]}
        query={needle.trim()}
        spaces={names}
        owners={Owners.options(spaceList)}
        userId={props.userId}
        emptyMessage="No credentials"
        onChanged={refresh}
      />
      {creating ? (
        <PasteCredentialDialog
          title="Add credential to this space"
          description="Every chat in this space can use it."
          owners={[{ value: `space:${props.spaceId}`, label: names.get(props.spaceId) ?? "This space", glyph: "Cube" }]}
          userId={props.userId}
          submitLabel="Save credential"
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
          <List.Root label="Credentials in other spaces">
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
                    Copy credential
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
