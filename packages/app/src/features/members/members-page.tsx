import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { PageShell } from "@ren/ui/page-shell"
import { SearchField } from "@ren/ui/search-field"
import { Tabs } from "@ren/ui/tabs"
import { Toolbar } from "@ren/ui/toolbar"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { AddMembersDialog } from "./add-members-dialog.js"
import { InvitationsTable } from "./invitations-table.js"
import { Members } from "./members.js"
import { MembersTable } from "./members-table.js"

export function MembersPage(props: {
  organizationId: string
  userId: string
  tab: Members.Tab
  onTabChange: (tab: Members.Tab) => void
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const options = Auth.organizationOptions(context.auth, props.organizationId)
  const organization = useQuery(options)
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState(false)
  const needle = useDeferredValue(query)
  const members = Members.memberRows(organization.data?.members ?? [], props.userId)
  const invitations = Members.invitationRows(organization.data?.invitations ?? [])
  const table = {
    query: needle,
    state: ({ pending: "loading", error: "failed", success: "ready" } as const)[organization.status],
    organizationId: props.organizationId,
    // ast-grep-ignore: no-manual-invalidation -- members and invitations change through Better Auth
    onChanged: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  } as const
  return (
    <PageShell.Root title="Members" subtitle="Everyone in your organization.">
      <Toolbar.Root
        alignment="split"
        leading={
          <Tabs.Root
            value={props.tab}
            onValueChange={(next: Members.Tab) => {
              if (next === props.tab) return
              setQuery("")
              props.onTabChange(next)
            }}
          >
            <Tabs.List label="Members">
              <Tabs.Tab value="members" count={members.length}>
                Members
              </Tabs.Tab>
              <Tabs.Tab value="invitations" count={invitations.length}>
                Invitations
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.Root>
        }
      >
        <SearchField.Expandable
          value={query}
          onValueChange={setQuery}
          placeholder={props.tab === "members" ? "Search for a member" : "Search for an invitation"}
        />
        <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setAdding(true)}>
          Add member
        </Button>
      </Toolbar.Root>
      <section key={props.tab} aria-live="polite">
        {props.tab === "members" ? (
          <MembersTable
            {...table}
            rows={members}
            failureMessage={`Couldn’t load members. ${organization.error?.message ?? ""}`.trim()}
          />
        ) : (
          <InvitationsTable
            {...table}
            rows={invitations}
            failureMessage={`Couldn’t load invitations. ${organization.error?.message ?? ""}`.trim()}
          />
        )}
      </section>
      {adding ? (
        <AddMembersDialog
          onClose={() => setAdding(false)}
          organizationId={props.organizationId}
          onChanged={table.onChanged}
        />
      ) : null}
    </PageShell.Root>
  )
}
