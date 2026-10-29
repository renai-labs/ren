import { useState } from "react"
import { IconPlus, IconSearch } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { AddHere, type Added } from "@/components/ren/add-to-space"
import { AppGrid, AppRow } from "@/components/ren/app-list"
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
  const rows = catalog.apps.filter((app) => !props.added.has(app.id) && matches(app, query))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.open === undefined ? (
        <DialogTrigger render={<Button />}>
          <IconPlus />
          Add app
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add apps to {props.space.name}</DialogTitle>
          <DialogDescription>Every chat in the space can use it once its account is connected.</DialogDescription>
        </DialogHeader>
        <InputGroup>
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
        <div className="-mx-1 h-[min(28rem,60vh)] overflow-y-auto overscroll-contain px-1 pb-1">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {catalog.loading
                ? "Loading apps…"
                : query
                  ? `Nothing matches “${query.trim()}”`
                  : `${props.space.name} has every app`}
            </p>
          ) : (
            <AppGrid label="Apps">
              {rows.map((app) => (
                <AppRow
                  key={app.id}
                  name={app.name}
                  icon={app.icon}
                  caption={app.description}
                  action={
                    <AddHere
                      app={app}
                      space={props.space}
                      onAdded={(added) => {
                        setOpen(false)
                        props.onAdded(added)
                      }}
                    />
                  }
                />
              ))}
            </AppGrid>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
