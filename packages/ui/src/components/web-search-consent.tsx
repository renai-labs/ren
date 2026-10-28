import { useId } from "react"
import { Button } from "./button.js"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./select.js"
import { Spinner } from "./spinner.js"
import { Text } from "./text.js"

export type WebSearchProvider = { value: string; label: string }

export type WebSearchProviders = "loading" | "failed" | "ready"

export type WebSearchConsentProps = {
  providers: ReadonlyArray<WebSearchProvider>
  providerState: WebSearchProviders
  value: string | undefined
  onValueChange: (value: string) => void
  onEnable: () => void
  onDisable?: (() => void) | undefined
  onRetry: () => void
  pending?: boolean
  disabled?: boolean
  failed?: boolean
}

function Status(props: WebSearchConsentProps & { busy: boolean }) {
  if (props.providerState === "failed")
    return (
      <>
        <Text purpose="caption" element="span">
          Could not load the search providers.
        </Text>
        <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onRetry}>
          Try again
        </Button>
      </>
    )
  if (props.providerState === "loading")
    return (
      <Text purpose="caption" element="span">
        Loading search providers…
      </Text>
    )
  if (props.failed === true)
    return (
      <Text purpose="caption" tone="danger" element="span">
        Could not save your choice. Try again.
      </Text>
    )
  if (props.providers.length === 0)
    return (
      <Text purpose="caption" element="span">
        No search providers are available.
      </Text>
    )
  return null
}

export function WebSearchConsent(props: WebSearchConsentProps) {
  const title = useId()
  const description = useId()
  const pending = props.pending === true
  const busy = pending || props.disabled === true
  const unavailable = props.providerState !== "ready" || props.providers.length === 0
  const chosen = props.providers.some((provider) => provider.value === props.value)
  return (
    <section
      data-slot="web-search-consent"
      aria-labelledby={title}
      aria-describedby={description}
      aria-busy={pending || undefined}
      className="flex w-full min-w-0 animate-entrance flex-col gap-2 rounded-container border border-border-primary bg-background-secondary px-4 pt-4 pb-2 shadow-overlay"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Text id={title} purpose="label" element="h2">
            Third-party web search
          </Text>
          <Text id={description} purpose="caption">
            Choose the search provider Ren uses to search the web.
          </Text>
        </div>
        <Select
          items={[{ value: null, label: "Search provider" }, ...props.providers]}
          value={chosen ? (props.value ?? null) : null}
          onValueChange={(next) => {
            if (typeof next === "string") props.onValueChange(next)
          }}
          disabled={busy || unavailable}
        >
          <SelectTrigger size="sm" aria-label="Search provider" className="max-w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {props.providers.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-h-9 w-full min-w-0 flex-wrap items-center justify-end gap-1 pt-1">
        <output className="mr-auto flex min-w-0 items-center gap-2">
          <Status {...props} busy={busy} />
        </output>
        {props.onDisable ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={props.onDisable}>
            Turn off web search
          </Button>
        ) : null}
        <Button variant="default" size="sm" disabled={busy || unavailable || !chosen} onClick={props.onEnable}>
          {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Turn on web search
        </Button>
      </div>
    </section>
  )
}
