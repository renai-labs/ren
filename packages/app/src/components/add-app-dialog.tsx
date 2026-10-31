import { useState } from "react"
import { IconPlus, IconSearch } from "@tabler/icons-react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { useAddition, type Added } from "./add-to-space.js"
import { AppRow } from "./app-list.js"
import { useCatalog } from "../lib/use-catalog.js"
import { cn } from "cn"

type CatalogApp = ReturnType<typeof useCatalog>["apps"][number]

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

function emptyText(catalog: { readonly loading: boolean }, query: string, space: string) {
  if (catalog.loading) return "Loading apps…"
  if (query) return `Nothing matches “${query.trim()}”`
  return `${space} has every app`
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
  const catalog = useCatalog()
  const found = catalog.apps.filter((app) => !props.added.has(app.id) && matches(app, query))
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
          {found.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {emptyText(catalog, query, props.space.name)}
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
