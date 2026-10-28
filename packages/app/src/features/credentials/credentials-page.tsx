import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Page } from "@ren/ui/page"
import { SearchField } from "@ren/ui/search-field"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { useQuery } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import type { ReactNode } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { PasteCredentialDialog } from "../../components/paste-credential-dialog.js"
import { Credentials } from "../../components/credentials.js"
import { CredentialsTable } from "./credentials-table.js"
import { Owners } from "./owners.js"

export type Tab = "apps" | "credentials"

// oxlint-disable-next-line ren/no-comments -- The space Apps and Credentials tabs, for the whole org: app accounts, and loose credentials.
export function CredentialsPage(props: { userId: string; tab: Tab; apps: ReactNode; onTabChange: (tab: Tab) => void }) {
  const context = RouterContext.useRouterContext()
  const credentials = useQuery(
    context.api.credential.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
  )
  const spaces = useQuery(
    context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize, joined: true }),
  )
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const needle = useDeferredValue(query)
  const spaceList = spaces.data?.items ?? []
  const names = new Map(spaceList.map((space) => [space.id, space.name]))
  const items = (credentials.data?.items ?? []).filter((item) => item.owner.kind !== "profile")
  const visible = items.filter((item) => Credentials.matches(item, needle))
  const owners = Owners.options(spaceList)
  const state = { pending: "loading", error: "failed", success: visible.length > 0 ? "ready" : "empty" } as const
  return (
    <Page.Root
      title="Credentials"
      description="The app accounts and credentials your organization’s chats use."
      leading={
        <Tabs value={props.tab} onValueChange={(next: Tab) => props.onTabChange(next)}>
          <TabsList variant="page" aria-label="Credential kinds">
            <TabsTrigger value="apps">Apps</TabsTrigger>
            <TabsTrigger value="credentials">
              Credentials
              <span className="text-muted-foreground tabular-nums">{items.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
      actions={
        props.tab === "credentials" ? (
          <>
            <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search credentials" />
            <Button size="sm" onClick={() => setCreating(true)}>
              <Icon glyph="Plus" data-icon="inline-start" />
              Add credential
            </Button>
          </>
        ) : undefined
      }
    >
      {props.tab === "apps" ? props.apps : null}
      {props.tab === "credentials" ? (
        <CredentialsTable
          rows={visible}
          state={state[credentials.status]}
          query={needle.trim()}
          spaces={names}
          owners={owners}
          userId={props.userId}
          emptyMessage="No credentials"
        />
      ) : null}
      {creating ? (
        <PasteCredentialDialog
          title="Add credential"
          description="Paste a key. Ren keeps it encrypted and never shows it again."
          owners={owners}
          userId={props.userId}
          submitLabel="Save credential"
          onClose={() => setCreating(false)}
        />
      ) : null}
    </Page.Root>
  )
}
