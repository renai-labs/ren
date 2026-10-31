import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Page } from "@ren/ui/page"
import { SearchField } from "@ren/ui/search-field"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
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
    <Page.Root
      title="Members"
      description="Everyone in your organization."
      leading={
        <Tabs
          value={props.tab}
          onValueChange={(next: Members.Tab) => {
            if (next === props.tab) return
            setQuery("")
            props.onTabChange(next)
          }}
        >
          <TabsList variant="page" aria-label="Members">
            <TabsTrigger value="members">
              Members
              <span className="text-muted-foreground tabular-nums">{members.length}</span>
            </TabsTrigger>
            <TabsTrigger value="invitations">
              Invitations
              <span className="text-muted-foreground tabular-nums">{invitations.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
      actions={
        <>
          <SearchField.Expandable
            value={query}
            onValueChange={setQuery}
            placeholder={props.tab === "members" ? "Search for a member" : "Search for an invitation"}
          />
          <Button size="sm" onClick={() => setAdding(true)}>
            <Icon glyph="Plus" data-icon="inline-start" />
            Add member
          </Button>
        </>
      }
    >
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
    </Page.Root>
  )
}
