import { useState } from "react"
import type { ArtifactInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Loading } from "@ren/ui/loading"
import { formatDate } from "@ren/ui/time"
import { IconBrowser, IconChevronDown, IconCube, IconLock, IconSparkles } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { cn } from "cn"
import { ArtifactMenu, ServingBadge, useArtifactActions } from "../../components/artifact-actions.js"
import { MenuSearch } from "../../components/menu-search.js"
import { FileRow, FileTable, FileTableSample, rowLink } from "../../components/file-table.js"
import { Page, PageActions, TableEmpty, useShapeId } from "../../components/page.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { WorkspacePending } from "../../components/workspace-pending.js"
import { Artifacts } from "../../lib/artifacts.js"
import { QueryResult } from "../../lib/query-result.js"
import { RouterContext } from "../../lib/router-context.js"
import { Search } from "../../lib/search.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { ArtifactThumbnail } from "./artifact-thumbnail.js"
import { DriveCrumbs } from "./drive-crumbs.js"

const route = getRouteApi("/_authed/_shell/drive/artifacts")

const spaceRoute = getRouteApi("/_authed/_shell/spaces/$spaceId/drive/artifacts")

function Build(props: { space: string | undefined }) {
  const spaces = useSpaces()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const build = (spaceId: string) => void navigate({ to: "/", search: { spaceId, prompt: "Build an artifact: " } })
  const space = props.space
  if (space)
    return (
      <Button onClick={() => build(space)}>
        <IconSparkles data-icon="inline-start" />
        Build with Ren
      </Button>
    )
  const joined = spaces.joined.filter((each) => Search.matches(query, each.name))
  return (
    <DropdownMenu onOpenChange={(open) => (open ? undefined : setQuery(""))}>
      <DropdownMenuTrigger render={<Button />}>
        <IconSparkles data-icon="inline-start" />
        Build with Ren
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {spaces.joined.length > 6 ? <MenuSearch value={query} onChange={setQuery} placeholder="Find a space" /> : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Start a chat in</DropdownMenuLabel>
          {joined.length === 0 ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No spaces</div> : null}
          {joined.map((each) => (
            <DropdownMenuItem key={each.id} onClick={() => build(each.id)}>
              {each.kind === "private" ? <IconLock /> : <IconCube />}
              <span className="truncate">{each.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ArtifactRow(props: {
  artifact: ArtifactInfo
  spaceName: string | undefined
  actions: ReturnType<typeof useArtifactActions>
}) {
  const artifact = props.artifact
  const url = artifact.url
  return (
    <FileRow
      className={url === null ? "cursor-default" : undefined}
      media={<ArtifactThumbnail artifact={artifact} className="w-7 rounded-sm border" />}
      name={
        url === null ? (
          <span className="min-w-0 truncate">{artifact.title}</span>
        ) : (
          <Button
            variant="link"
            onClick={() => props.actions.open(url)}
            className={cn(
              "block h-auto justify-start p-0 text-left font-normal text-foreground hover:no-underline active:not-aria-[haspopup]:scale-none",
              rowLink,
            )}
          >
            {artifact.title}
          </Button>
        )
      }
      badge={<ServingBadge artifact={artifact} />}
      cells={[
        Artifacts.host(url) ?? "No link",
        ...(props.spaceName === undefined ? [] : [props.spaceName]),
        formatDate(artifact.updatedAt),
      ]}
      menu={<ArtifactMenu artifact={artifact} actions={props.actions} className="flex text-muted-foreground" />}
    />
  )
}

function ArtifactList(props: { space: string | undefined }) {
  const { client } = RouterContext.useRouterContext()
  const artifacts = useQuery(Artifacts.allOptions(client, props.space))
  const spaces = useSpaces()
  const actions = useArtifactActions()
  const shapeId = useShapeId("drive-artifacts")
  const [query, setQuery] = useState("")
  const all = artifacts.data
  const shown = (all ?? [])
    .filter((artifact) =>
      Search.matches(query, artifact.title, Artifacts.host(artifact.url), spaces.spaceName(artifact.spaceId)),
    )
    .toSorted((a, b) => a.title.localeCompare(b.title) || a.createdAt.localeCompare(b.createdAt))
  const columns = [
    { label: "Link", className: "w-64" },
    ...(props.space ? [] : [{ label: "Space", className: "w-48" }]),
    { label: "Date modified", className: "w-44" },
  ]
  return (
    <>
      <PageActions>
        <ToolbarSearch label="Search artifacts" value={query} onChange={setQuery} />
        <Build space={props.space} />
      </PageActions>
      {artifacts.error && !all ? (
        <WorkspacePending
          result={QueryResult.of(artifacts)}
          icon={<IconBrowser />}
          title="Could not load the artifacts"
          onRetry={() => void artifacts.refetch()}
        />
      ) : (
        <Loading id={shapeId} loading={!all} label="Loading artifacts">
          {all === undefined ? <FileTableSample columns={columns} count={4} /> : null}
          {all?.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconBrowser />
                </EmptyMedia>
                <EmptyTitle>No artifacts yet</EmptyTitle>
                <EmptyDescription>
                  Sites and apps Ren publishes show up here, each at a link anyone can open. Use Build with Ren to ask
                  for one.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {all?.length ? (
            <FileTable columns={columns}>
              {shown.length === 0 ? (
                <TableEmpty columns={columns.length + 2}>{Search.empty(query, "No artifacts")}</TableEmpty>
              ) : null}
              {shown.map((artifact) => (
                <ArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  spaceName={props.space ? undefined : spaces.spaceName(artifact.spaceId)}
                  actions={actions}
                />
              ))}
            </FileTable>
          ) : null}
        </Loading>
      )}
    </>
  )
}

export function ArtifactsPage() {
  const space = route.useSearch({ select: (search) => search.space })
  const home = { kind: "org" } as const
  return (
    <Page
      title="Artifacts"
      width="full"
      leading={<DriveCrumbs home={home} space={space} folder={undefined} last="Artifacts" />}
    >
      <ArtifactList key={space ?? ""} space={space} />
    </Page>
  )
}

export function SpaceArtifactsPage() {
  const spaceId = spaceRoute.useParams({ select: (params) => params.spaceId })
  return (
    <>
      <DriveCrumbs home={{ kind: "space", spaceId }} space={spaceId} folder={undefined} last="Artifacts" />
      <ArtifactList key={spaceId} space={spaceId} />
    </>
  )
}
