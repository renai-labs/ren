import { useState } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { IconChevronRight, IconPlus, IconSearch } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { AppRow } from "./app-list.js"
import { LoadMore } from "./load-more.js"
import { useAddManaged } from "./profile-dialog.js"
import { Loading } from "@ren/ui/loading"
import { AppRegistryPages } from "../lib/app-registry.js"
import { Search } from "../lib/search.js"
import { fromApp, fromRegistry, hasManaged, isSpaceApp, type CatalogApp } from "../lib/apps.js"
import { errorMessage } from "../lib/errors.js"
import { pickerPageSize } from "../lib/pagination.js"
import { useSpaces } from "../lib/use-spaces.js"
import { useDebouncedValue } from "../lib/use-debounced-value.js"
import { RouterContext } from "../lib/router-context.js"
import { cn } from "cn"

function AddAppRow(props: {
  app: CatalogApp
  space: string
  managed: boolean
  adding: boolean
  onPick: (app: CatalogApp) => void
  onAdd: (app: CatalogApp) => void
}) {
  return (
    <AppRow
      compact
      name={props.app.name}
      icon={props.app.icon}
      caption={props.app.description}
      onOpen={() => props.onPick(props.app)}
      action={
        props.managed ? (
          <span className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Ren credits</span>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Add ${props.app.name} to ${props.space}`}
              disabled={props.adding}
              onClick={() => props.onAdd(props.app)}
            >
              {props.adding ? <Spinner data-icon="inline-start" /> : null}
              Add
            </Button>
          </span>
        ) : (
          <span aria-hidden className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none")}>
            Add
            <IconChevronRight data-icon="inline-end" />
          </span>
        )
      }
    />
  )
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
  onPick: (app: CatalogApp) => void
}) {
  const { api, client } = RouterContext.useRouterContext()
  const needle = useDebouncedValue(props.query.trim(), 200)
  const spaces = useSpaces()
  const addManaged = useAddManaged()
  const [adding, setAdding] = useState<string>()
  const pages = useInfiniteQuery(AppRegistryPages.options(client, needle))
  const apps = useQuery(api.app.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const listed = (pages.data?.pages ?? []).flatMap((page) => page.items)
  const own = (apps.data?.items ?? [])
    .map(fromApp)
    .filter((app) => !isSpaceApp(app, spaces.spaces) && Search.matches(props.query, app.name, app.description))
  const managed = new Set([
    ...listed.filter((app) => app.managed).map((app) => app.id),
    ...own.filter(hasManaged).map((app) => app.id),
  ])
  const found = [...own, ...listed.map(fromRegistry)].filter((app) => !props.added.has(app.id))
  const loading = pages.isPending || apps.isPending
  const space = spaces.space(props.space.id)
  const add = (app: CatalogApp) => {
    setAdding(app.id)
    void addManaged(app, {
      spaceId: props.space.id,
      name: props.space.name,
      members: space?.memberCount ?? 1,
      private: space?.kind === "private",
    })
      .then(
        () => toast.success(`${app.name} added to ${props.space.name}`, { description: "Uses Ren credits." }),
        (error: unknown) =>
          toast.error(`Couldn’t add ${app.name} to ${props.space.name}`, { description: errorMessage(error) }),
      )
      .finally(() => setAdding(undefined))
  }
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a list of Item rows; Item renders a div
      role="list"
      aria-label="Apps"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4"
    >
      {loading ? <AppRowsSample count={8} /> : null}
      {!loading && found.length === 0 && !pages.hasNextPage ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {Search.empty(props.query, `${props.space.name} has every app`)}
        </p>
      ) : null}
      {found.map((app) => (
        <AddAppRow
          key={app.id}
          app={app}
          space={props.space.name}
          managed={managed.has(app.id)}
          adding={adding === app.id}
          onPick={props.onPick}
          onAdd={add}
        />
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
  onPick: (app: CatalogApp) => void
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
          onPick={(app) => {
            setOpen(false)
            props.onPick(app)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
