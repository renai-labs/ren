import { useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { IconPlus, IconSearch } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { useAddition, type Added } from "./add-to-space.js"
import { AppRow } from "./app-list.js"
import { LoadMore } from "./load-more.js"
import { Loading } from "@ren/ui/loading"
import { AppRegistryPages } from "../lib/app-registry.js"
import { fromApp, fromRegistry, isSpaceApp, type CatalogApp } from "../lib/apps.js"
import { pickerPageSize } from "../lib/pagination.js"
import { useSpaces } from "../lib/use-spaces.js"
import { useDebouncedValue } from "../lib/use-debounced-value.js"
import { RouterContext } from "../lib/router-context.js"
import { cn } from "cn"

function AddAppRow(props: { app: CatalogApp; space: { id: string; name: string }; onAdded: Added }) {
  const addition = useAddition(props.app, props.onAdded)
  return (
    <>
      <AppRow
        compact
        name={props.app.name}
        icon={props.app.icon}
        caption={props.app.description}
        onOpen={() => addition.add(props.space)}
        action={
          <span
            aria-hidden
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "pointer-events-none text-muted-foreground",
            )}
          >
            <IconPlus />
          </span>
        }
      />
      {addition.dialog}
    </>
  )
}

const matches = (app: { name: string; description: string }, query: string) =>
  `${app.name} ${app.description}`.toLowerCase().includes(query.trim().toLowerCase())

function emptyText(query: string, space: string) {
  if (query) return `Nothing matches “${query.trim()}”`
  return `${space} has every app`
}

function AppRowsSample(props: { count: number }) {
  return (
    <Loading label="Loading apps">
      {Array.from({ length: props.count }, (_, index) => (
        <AppRow key={index} compact name="Team app" caption="Tools for your team’s work" />
      ))}
    </Loading>
  )
}

function AppResults(props: {
  query: string
  space: { id: string; name: string }
  added: ReadonlySet<string>
  onAdded: Added
}) {
  const { api, client } = RouterContext.useRouterContext()
  const needle = useDebouncedValue(props.query.trim(), 200)
  const spaces = useSpaces().spaces
  const pages = useInfiniteQuery(AppRegistryPages.options(client, needle))
  const apps = useQuery(api.app.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const registry = (pages.data?.pages ?? []).flatMap((page) => page.items).map(fromRegistry)
  const own = (apps.data?.items ?? [])
    .map(fromApp)
    .filter((app) => !isSpaceApp(app, spaces) && matches(app, props.query))
  const found = [...own, ...registry].filter((app) => !props.added.has(app.id))
  const loading = pages.isPending || apps.isPending
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a list of Item rows; Item renders a div
      role="list"
      aria-label="Apps"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4"
    >
      {loading ? <AppRowsSample count={8} /> : null}
      {!loading && found.length === 0 && !pages.hasNextPage ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{emptyText(props.query, props.space.name)}</p>
      ) : null}
      {found.map((app) => (
        <AddAppRow key={app.id} app={app} space={props.space} onAdded={props.onAdded} />
      ))}
      <LoadMore
        more={pages.hasNextPage}
        onMore={() => {
          if (!pages.isFetchingNextPage) void pages.fetchNextPage()
        }}
      />
      {pages.isFetchingNextPage ? <AppRowsSample count={3} /> : null}
    </div>
  )
}

export function AddAppDialog(props: {
  space: { id: string; name: string }
  added: ReadonlySet<string>
  onAdded: Added
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = props.open ?? ownOpen
  const setOpen = props.onOpenChange ?? setOwnOpen
  const [query, setQuery] = useState("")
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.open === undefined ? (
        <DialogTrigger render={<Button />}>
          <IconPlus />
          Add app
        </DialogTrigger>
      ) : null}
      <DialogContent className="flex h-[min(--spacing(140),calc(100dvh-(--spacing(16))))] flex-col gap-0 p-0 sm:max-w-140">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-base">Add apps to {props.space.name}</DialogTitle>
          <DialogDescription>Pick the apps this space can use. You can add more later.</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-3">
          <InputGroup className="h-9">
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search apps"
              placeholder="Search apps"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        </div>
        <AppResults
          query={query}
          space={props.space}
          added={props.added}
          onAdded={(added) => {
            setOpen(false)
            props.onAdded(added)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
