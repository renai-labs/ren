import { Pagination } from "@ren/schema/pagination"
import type { SpaceInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@ren/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { PageShell } from "@ren/ui/page-shell"
import { SearchField } from "@ren/ui/search-field"
import { Toolbar } from "@ren/ui/toolbar"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useDeferredValue, useState } from "react"
import { Search } from "@ren/util/search"
import { RouterContext } from "../../lib/router-context.js"
import { CreateSpaceDialog } from "./create-space-dialog.js"
import { JoinSpaceDialog } from "./join-space-dialog.js"

export function SpacesPage(props: { userId: string }) {
  const context = RouterContext.useRouterContext()
  const spaces = useQuery(context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize }))
  const [query, setQuery] = useState("")
  const needle = useDeferredValue(query).trim()
  const visible = (spaces.data?.items ?? []).filter((space) =>
    Search.matches([space.name, space.description ?? ""], needle),
  )
  return (
    <PageShell.Root
      title="Spaces"
      subtitle="Each space gives a team its own credentials, apps and agents."
      toolbar={
        <Toolbar.Root>
          <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search spaces" />
          <SpaceActions spaces={spaces.data?.items ?? []} userId={props.userId} />
        </Toolbar.Root>
      }
    >
      <section aria-label="Spaces" aria-live="polite">
        {visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon glyph="Cube" />
              </EmptyMedia>
              <EmptyTitle>{needle ? "No matching spaces" : "No spaces yet"}</EmptyTitle>
              <EmptyDescription>
                {needle ? "Try a different search." : "Create one to bring people together."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {visible.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {visible.map((space) => (
              <SpaceCard key={space.id} space={space} />
            ))}
          </div>
        ) : null}
      </section>
    </PageShell.Root>
  )
}

function SpaceCard(props: { space: SpaceInfo }) {
  const space = props.space
  return (
    <Link
      to="/spaces/$spaceId"
      params={{ spaceId: space.id }}
      aria-label={`Open ${space.name}`}
      className="group/space rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-4 border shadow-soft ring-0 transition-colors [--card-spacing:--spacing(6)] group-hover/space:bg-muted">
        <CardHeader>
          <span className="mb-3 flex size-12 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon glyph={space.kind === "private" ? "Lock" : "Cube"} size="extra-large" />
          </span>
          <CardTitle className="text-sm/5">{space.name}</CardTitle>
          <CardDescription className="line-clamp-2 text-xs">
            {space.description?.trim() || "No description"}
          </CardDescription>
        </CardHeader>
        <CardFooter className="mx-6 mb-6 gap-2 bg-transparent px-0 pt-3 pb-0 text-xs text-muted-foreground tabular-nums">
          <Icon glyph={space.kind === "private" ? "Lock" : "Users"} />
          {space.kind === "private"
            ? "Private"
            : `${space.memberCount} ${space.memberCount === 1 ? "member" : "members"}`}
        </CardFooter>
      </Card>
    </Link>
  )
}

function SpaceActions(props: { spaces: ReadonlyArray<SpaceInfo>; userId: string }) {
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const canJoin = props.spaces.some((space) => space.canJoin)
  return (
    <>
      {canJoin ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-sm" aria-label="Create or join a space" />}>
            <Icon glyph="Plus" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setCreating(true)}>
                <Icon glyph="Plus" />
                Create space
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setJoining(true)}>
                <Icon glyph="LogIn" />
                Join space
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button size="sm" onClick={() => setCreating(true)}>
          <Icon glyph="Plus" data-icon="inline-start" />
          New space
        </Button>
      )}
      {creating ? <CreateSpaceDialog onClose={() => setCreating(false)} /> : null}
      {joining ? (
        <JoinSpaceDialog spaces={props.spaces} userId={props.userId} onClose={() => setJoining(false)} />
      ) : null}
    </>
  )
}
