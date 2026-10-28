import type { CredentialInfo } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@ren/ui/item"
import { SearchField } from "@ren/ui/search-field"
import { toast } from "@ren/ui/toast"
import { Page } from "@ren/ui/page"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { PasteCredentialDialog } from "../../components/paste-credential-dialog.js"
import { Credentials } from "../../components/credentials.js"
import { CredentialsTable } from "./credentials-table.js"
import { Owners } from "./owners.js"

export function SpaceCredentials(props: { spaceId: string; userId: string }) {
  const context = RouterContext.useRouterContext()
  const all = useQuery(context.api.credential.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }))
  const spaces = useQuery(
    context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize, joined: true }),
  )

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
  const state = { pending: "loading", error: "failed", success: visible.length > 0 ? "ready" : "empty" } as const
  const add =
    elsewhere.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" aria-label="Add or copy a credential" />}>
          <Icon glyph="Plus" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setCreating(true)}>
              <Icon glyph="Plus" />
              Add credential
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCopying(true)}>
              <Icon glyph="Copy" />
              Copy from a space
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button size="sm" onClick={() => setCreating(true)}>
        <Icon glyph="Plus" data-icon="inline-start" />
        Add credential
      </Button>
    )
  return (
    <>
      <Page.Toolbar
        actions={
          <>
            <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search credentials" />
            {add}
          </>
        }
      />
      <CredentialsTable
        rows={visible}
        state={state[all.status]}
        query={needle.trim()}
        spaces={names}
        owners={Owners.options(spaceList)}
        userId={props.userId}
        emptyMessage="No credentials"
      />
      {creating ? (
        <PasteCredentialDialog
          title="Add credential to this space"
          description="Every chat in this space can use it."
          owners={[{ value: `space:${props.spaceId}`, label: names.get(props.spaceId) ?? "This space", glyph: "Cube" }]}
          userId={props.userId}
          submitLabel="Save credential"
          onClose={() => setCreating(false)}
        />
      ) : null}
      {copying ? (
        <CopyFromSpaceDialog
          spaceId={props.spaceId}
          candidates={elsewhere}
          spaces={names}
          onClose={() => setCopying(false)}
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
}) {
  const context = RouterContext.useRouterContext()
  const copy = useMutation(context.api.credential.copy.mutationOptions())
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !copy.isPending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy from a space</DialogTitle>
          <DialogDescription>
            A copy is a separate pasted key. Sign-ins cannot be copied; move them instead.
          </DialogDescription>
        </DialogHeader>
        <ItemGroup aria-label="Credentials in other spaces" className="gap-1">
          {props.candidates.map((candidate) => (
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div in the ItemGroup list
            <Item key={candidate.id} role="listitem" className="px-0 py-2">
              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="max-w-full">
                  <span className="truncate">{candidate.name ?? candidate.label}</span>
                </ItemTitle>
                <ItemDescription className="line-clamp-1 text-xs">
                  {`${candidate.label} · ${Credentials.ownerLabel(candidate.owner, props.spaces, "")}`}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={copy.isPending}
                  onClick={() =>
                    void copy
                      .mutateAsync({ id: candidate.id, owner: { kind: "space", spaceId: props.spaceId } })
                      .then(() => toast.add({ type: "success", title: `${candidate.label} copied` }))
                      .catch(() => undefined)
                  }
                >
                  Copy credential
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
        {copy.error ? (
          <Alert variant="destructive">
            <Icon glyph="AlertCircle" />
            <AlertDescription>{copy.error.message}</AlertDescription>
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
