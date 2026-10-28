import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { SearchField } from "@ren/ui/search-field"
import { Spinner } from "@ren/ui/spinner"
import { useDeferredValue, useState } from "react"
import { AddHere } from "./add-to-space.js"
import { AppGrid, AppRow } from "./app-row.js"
import { Apps } from "./apps.js"

// oxlint-disable-next-line ren/no-comments -- ren-v1 composer "Add an app": the Marketplace grid for the composer's space.
export function AddAppDialog(props: {
  space: { readonly id: string; readonly name: string }
  added: ReadonlySet<string>
  onAdded: (added: { readonly appId: string; readonly profileId: string }) => void
  onClose: () => void
}) {
  const catalog = Apps.useCatalog()
  const [query, setQuery] = useState("")
  const needle = useDeferredValue(query).trim()
  const rows = catalog.entries.filter((entry) => !props.added.has(entry.id) && Apps.matches(entry, needle))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className="sm:max-w-256">
        <DialogHeader>
          <DialogTitle>{`Add an app to ${props.space.name}`}</DialogTitle>
          <DialogDescription>Every chat in the space can use it once its account is connected.</DialogDescription>
        </DialogHeader>
        <SearchField.Root value={query} onValueChange={setQuery} placeholder="Search apps" />
        <div className="-mx-2 h-112 max-h-[60vh] overflow-y-auto overscroll-contain">
          {catalog.state === "loading" ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia>
                  <Spinner />
                </EmptyMedia>
              </EmptyHeader>
            </Empty>
          ) : null}
          {catalog.state === "failed" ? (
            <Empty role="alert">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon glyph="AlertCircle" />
                </EmptyMedia>
                <EmptyTitle>Couldn’t load apps.</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => void catalog.retry()}>
                  Try again
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
          {catalog.state === "ready" && rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon glyph="Search" />
                </EmptyMedia>
                <EmptyTitle>{`Nothing matches “${needle}”`}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}
          <AppGrid label="Apps">
            {rows.map((entry) => (
              <AppRow
                key={entry.id}
                name={entry.name}
                icon={entry.icon}
                caption={entry.description}
                action={
                  <AddHere
                    app={entry}
                    profiles={catalog.profiles.get(entry.id) ?? []}
                    space={props.space}
                    onAdded={(profileId) => props.onAdded({ appId: entry.id, profileId })}
                  />
                }
              />
            ))}
          </AppGrid>
        </div>
      </DialogContent>
    </Dialog>
  )
}
