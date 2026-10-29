import { useState } from "react"
import { IconPlus, IconSearch } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { AddHere, type Added } from "@/components/ren/add-to-space"
import { AppRow } from "@/components/ren/app-list"
import { useCatalog } from "@/hooks/use-catalog"

const matches = (app: { name: string; description: string }, query: string) =>
  `${app.name} ${app.description}`.toLowerCase().includes(query.trim().toLowerCase())

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
  const found = catalog.apps.filter((app) => matches(app, query))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.open === undefined ? (
        <DialogTrigger render={<Button />}>
          <IconPlus />
          Add app
        </DialogTrigger>
      ) : null}
      <DialogContent className="flex h-[min(47.5rem,calc(100dvh-4rem))] flex-col gap-0 p-0 sm:max-w-182">
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
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-2"
        >
          {found.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {catalog.loading ? "Loading apps…" : `Nothing matches “${query.trim()}”`}
            </p>
          ) : null}
          {found.map((app) => (
            <AppRow
              key={app.id}
              compact
              name={app.name}
              icon={app.icon}
              caption={app.description}
              action={
                props.added.has(app.id) ? (
                  <span className="px-3 text-sm text-muted-foreground">Added</span>
                ) : (
                  <AddHere
                    app={app}
                    space={props.space}
                    onAdded={(added) => {
                      setOpen(false)
                      props.onAdded(added)
                    }}
                  />
                )
              }
            />
          ))}
        </div>
        <DialogFooter className="m-0 bg-muted/50 px-6 sm:justify-end">
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
