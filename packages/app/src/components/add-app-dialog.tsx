import { useState } from "react"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { IconPlus, IconSearch } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import { useAddition, type Added } from "./add-to-space.js"
import { AppRow } from "./app-list.js"
import { LoadMore } from "./load-more.js"
import { fromRegistry, type CatalogApp } from "../lib/apps.js"
import { RouterContext } from "../lib/router-context.js"
import { useCatalog } from "../lib/use-catalog.js"
import { useDebouncedValue } from "../lib/use-debounced-value.js"
import { cn } from "cn"

const registryPageSize = 50

const registryPagesKey = (query: string) => ["app-registry", "pages", { pageSize: registryPageSize, query }] as const

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

function emptyText(list: { readonly loading: boolean }, query: string, space: string) {
  if (list.loading) return "Loading apps…"
  if (query) return `Nothing matches “${query.trim()}”`
  return `${space} has every app`
}

function useRegistryPages(query: string, options: { enabled: boolean }) {
  const { client } = RouterContext.useRouterContext()
  return useInfiniteQuery({
    queryKey: registryPagesKey(query),
    queryFn: (context) =>
      client["app-registry"].list(
        { page: context.pageParam, pageSize: registryPageSize, ...(query && { query }) },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
    enabled: options.enabled,
  })
}

function NextPage(props: { registry: ReturnType<typeof useRegistryPages> }) {
  const registry = props.registry
  if (registry.isError)
    return (
      <div role="alert" className="flex items-center justify-center gap-3 py-4 text-sm text-muted-foreground">
        {registry.isFetchNextPageError ? "Couldn’t load more apps" : "Couldn’t load apps"}
        <Button
          variant="outline"
          size="sm"
          disabled={registry.isFetching}
          onClick={() => {
            if (registry.isFetchNextPageError) void registry.fetchNextPage()
            else void registry.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  return (
    <>
      {registry.isFetchingNextPage ? (
        <Loading label="Loading more apps">
          {Array.from({ length: 3 }, (_, index) => (
            <AppRow key={index} compact name="Team app" caption="Tools for your team’s work" />
          ))}
        </Loading>
      ) : null}
      {registry.hasNextPage ? (
        <LoadMore
          onVisible={() => {
            if (!registry.isFetching) void registry.fetchNextPage()
          }}
        />
      ) : null}
    </>
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
  const needle = useDebouncedValue(query.trim(), 250)
  const catalog = useCatalog()
  const registry = useRegistryPages(needle, { enabled: open })
  const listed = (registry.data?.pages.flatMap((page) => page.items) ?? []).map(
    (app) => catalog.appOf(app.id) ?? fromRegistry(app),
  )
  const listedIds = new Set(listed.map((app) => app.id))
  const custom =
    registry.isSuccess && !registry.hasNextPage
      ? catalog.apps.filter((app) => app.source === "custom" && !listedIds.has(app.id) && matches(app, needle))
      : []
  const found = [...listed, ...custom].filter((app) => !props.added.has(app.id))
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
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a list of Item rows; Item renders a div
          role="list"
          aria-label="Apps"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4"
        >
          {found.length === 0 && !registry.isError ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {emptyText({ loading: registry.isPending || registry.hasNextPage }, needle, props.space.name)}
            </p>
          ) : null}
          {found.map((app) => (
            <AddAppRow
              key={app.id}
              app={app}
              space={props.space}
              onAdded={(added) => {
                setOpen(false)
                props.onAdded(added)
              }}
            />
          ))}
          <NextPage registry={registry} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
