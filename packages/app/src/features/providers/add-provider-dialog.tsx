import { useDeferredValue, useState } from "react"
import type { ProviderCardAvailable } from "@ren/client"
import { IconSearch } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { EmptyState } from "../../components/empty-state.js"
import { ProviderMark } from "../../components/provider-mark.js"

const normalized = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "")

export function AddProviderDialog(props: {
  available: ReadonlyArray<ProviderCardAvailable>
  onConnect: (provider: ProviderCardAvailable) => void
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const search = normalized(useDeferredValue(query))
  const shown = props.available.filter(
    (provider) => !search || normalized(provider.name).includes(search) || normalized(provider.id).includes(search),
  )
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
          <DialogDescription>
            Connect a provider with your organization’s own key. You pay the provider.
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search providers"
            placeholder="Groq"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </InputGroup>
        {shown.length === 0 ? (
          <EmptyState
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          >
            {`No provider matches “${query}”`}
          </EmptyState>
        ) : (
          <ul
            aria-label="Providers you can add"
            className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-3"
          >
            {shown.map((provider) => (
              <li
                key={provider.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ProviderMark provider={provider.name} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{provider.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {provider.modelCount === 1 ? "1 model" : `${provider.modelCount} models`}
                    </span>
                  </div>
                </div>
                {provider.added ? (
                  <Badge variant="secondary">Added</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Connect ${provider.name}`}
                    onClick={() => props.onConnect(provider)}
                  >
                    Connect
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
