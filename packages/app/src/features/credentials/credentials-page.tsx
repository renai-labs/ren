import { Pagination } from "@ren/schema/pagination"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { PageShell } from "@ren/ui/page-shell"
import { SearchField } from "@ren/ui/search-field"
import { Tabs } from "@ren/ui/tabs"
import { Toolbar } from "@ren/ui/toolbar"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { PasteCredentialDialog } from "../../components/paste-credential-dialog.js"
import { Credentials } from "../../components/credentials.js"
import { CredentialsTable } from "./credentials-table.js"
import { Owners } from "./owners.js"

type Tab = "all" | Credentials.Group

export function CredentialsPage(props: { userId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const credentials = useQuery(
    context.api.credential.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }),
  )
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }))
  const [tab, setTab] = useState<Tab>("all")
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const needle = useDeferredValue(query)
  const spaceList = spaces.data?.items ?? []
  const names = new Map(spaceList.map((space) => [space.id, space.name]))
  const items = credentials.data?.items ?? []
  const visible = items
    .filter((item) => tab === "all" || Credentials.group(item.label) === tab)
    .filter((item) => Credentials.matches(item, needle))
  const owners = Owners.options(spaceList)
  const refresh = () => queryClient.invalidateQueries({ queryKey: context.api.credential.list.queryKey() })
  const state = { pending: "loading", error: "failed", success: visible.length > 0 ? "ready" : "empty" } as const
  return (
    <PageShell.Root
      title="Credentials"
      subtitle="Credentials your chats use. Chats get a placeholder; Ren puts in the key for the hosts you name."
    >
      <Toolbar.Root
        alignment="split"
        leading={
          <Tabs.Root value={tab} onValueChange={(next: Tab) => setTab(next)}>
            <Tabs.List label="Credential groups">
              <Tabs.Tab value="all" count={items.length}>
                All
              </Tabs.Tab>
              <Tabs.Tab value="mcp" count={items.filter((item) => Credentials.group(item.label) === "mcp").length}>
                MCP
              </Tabs.Tab>
              <Tabs.Tab value="other" count={items.filter((item) => Credentials.group(item.label) === "other").length}>
                Other
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        }
      >
        <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search credentials" />
        <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setCreating(true)}>
          Add credential
        </Button>
      </Toolbar.Root>
      <CredentialsTable
        rows={visible}
        state={state[credentials.status]}
        query={needle.trim()}
        spaces={names}
        owners={owners}
        userId={props.userId}
        emptyMessage="No credentials"
        onChanged={refresh}
      />
      {creating ? (
        <PasteCredentialDialog
          title="Add credential"
          description="Paste a key. Ren keeps it encrypted and never shows it again."
          owners={owners}
          userId={props.userId}
          submitLabel="Save credential"
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      ) : null}
    </PageShell.Root>
  )
}
