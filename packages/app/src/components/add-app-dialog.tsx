import { Dialog } from "@ren/ui/dialog"
import { LoadingMessage } from "@ren/ui/loading-message"
import { SearchField } from "@ren/ui/search-field"
import { StateMessage } from "@ren/ui/state-message"
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Dialog.Content size="extra-large" height="standard">
        <Dialog.Header>
          <Dialog.Title>{`Add an app to ${props.space.name}`}</Dialog.Title>
          <Dialog.Description>Every chat in the space can use it once its account is connected.</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <div className="flex flex-col gap-4">
            <SearchField.Root value={query} onValueChange={setQuery} placeholder="Search apps" />
            {catalog.state === "loading" ? <LoadingMessage placement="section" /> : null}
            {catalog.state === "failed" ? (
              <StateMessage state="failed" title="Couldn’t load apps." onRetry={() => void catalog.retry()} />
            ) : null}
            {catalog.state === "ready" && rows.length === 0 ? (
              <StateMessage state="no-results" title={`Nothing matches “${needle}”`} />
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
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  )
}
