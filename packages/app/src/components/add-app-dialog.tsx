import { useState } from "react"
import { IconChevronRight, IconPlus, IconSearch } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { AppRow } from "./app-list.js"
import { CustomAppDialog } from "./custom-app-dialog.js"
import { LoadMore } from "./load-more.js"
import { useAddManaged } from "./profile-dialog.js"
import { Loading } from "@ren/ui/loading"
import { Search } from "@ren/schema/search"
import type { CatalogApp } from "../lib/apps.js"
import { errorMessage } from "../lib/errors.js"
import { useSpaces } from "../lib/use-spaces.js"
import { AppRegistryPages } from "@ren/client/react"
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
  const context = RouterContext.useRouterContext()
  const spaces = useSpaces()
  const addManaged = useAddManaged()
  const [adding, setAdding] = useState<string>()
  const search = AppRegistryPages.useSearch({
    client: context.client,
    api: context.api,
    query: props.query,
    added: props.added,
  })
  const found = search.found
  const loading = search.loading
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
      data-part="results"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4"
    >
      {loading ? <AppRowsSample count={8} /> : null}
      {!loading && found.length === 0 && !search.more ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {Search.empty(props.query, `${props.space.name} has every app`)}
        </p>
      ) : null}
      {found.map((app) => (
        <AddAppRow
          key={app.id}
          app={app}
          space={props.space.name}
          managed={search.managed(app.id)}
          adding={adding === app.id}
          onPick={props.onPick}
          onAdd={add}
        />
      ))}
      <LoadMore more={search.more} onMore={search.loadMore} />
      {search.loadingMore ? <AppRowsSample count={3} /> : null}
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
  const [creating, setCreating] = useState(false)
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {props.open === undefined ? (
          <DialogTrigger render={<Button />}>
            <IconPlus />
            Add app
          </DialogTrigger>
        ) : null}
        <DialogContent
          data-dialog="add-app"
          data-height="fixed"
          className="flex h-[min(--spacing(140),calc(100dvh-(--spacing(16))))] flex-col gap-0 p-0 sm:max-w-140"
        >
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-base">Add apps to {props.space.name}</DialogTitle>
            <DialogDescription>Pick the apps this space can use. You can add more later.</DialogDescription>
          </DialogHeader>
          <div data-part="search" className="px-6 pb-3">
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
          <p
            data-part="foot"
            className="flex shrink-0 items-center justify-center gap-1 border-t px-6 py-3 text-sm text-muted-foreground"
          >
            Can’t find it?
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => {
                setOpen(false)
                setCreating(true)
              }}
            >
              Create app
            </Button>
          </p>
        </DialogContent>
      </Dialog>
      {creating ? <CustomAppDialog spaceId={props.space.id} onClose={() => setCreating(false)} /> : null}
    </>
  )
}
