import { useState } from "react"
import { Composer, ComposerHistory } from "@ren/chat"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@ren/ui/command"
import { Popover, PopoverContent } from "@ren/ui/popover"

const age = (sentAt: number, now: number) => {
  const minutes = Math.floor((now - sentAt) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export interface Opened {
  readonly saved: Composer.Draft
  readonly entries: ReadonlyArray<ComposerHistory.Entry>
  readonly now: number
}

export function HistorySearch(props: Panel & { open: Opened | undefined }) {
  return props.open ? <HistoryPanel {...props} open={props.open} /> : null
}

type Panel = Pick<Parameters<typeof HistoryPanel>[0], "anchor" | "returnFocus" | "onChange" | "onKeep" | "onDone">

function HistoryPanel(props: {
  open: Opened
  anchor: React.RefObject<HTMLElement | null>
  returnFocus: React.RefObject<HTMLElement | null>
  onChange: (draft: Composer.Draft) => void
  onKeep: (entry: ComposerHistory.Entry) => void
  onDone: () => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const search = props.open
  const found = ComposerHistory.search(search.entries, query)
  const preview = (entry: ComposerHistory.Entry | undefined) =>
    props.onChange(entry ? Composer.fromHistory(search.saved, entry) : search.saved)
  const close = () => {
    props.onChange(search.saved)
    props.onDone()
  }
  const keep = (entry: ComposerHistory.Entry) => {
    props.onChange(Composer.fromHistory(search.saved, entry))
    props.onKeep(entry)
    props.onDone()
  }
  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        anchor={props.anchor}
        finalFocus={props.returnFocus}
        className="w-3xl max-w-full gap-0 p-0"
      >
        <Command
          shouldFilter={false}
          value={String(active)}
          onValueChange={(value) => {
            setActive(Number(value))
            preview(found[Number(value)])
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            const entry = found[active]
            if (event.key === "Tab" && !event.shiftKey && entry) {
              event.preventDefault()
              keep(entry)
            }
            if (event.key === "g" && event.ctrlKey) {
              event.preventDefault()
              close()
            }
          }}
        >
          <CommandInput
            value={query}
            placeholder="Search earlier prompts"
            aria-label="Search history"
            onValueChange={(next) => {
              setQuery(next)
              setActive(0)
              preview(ComposerHistory.search(search.entries, next)[0])
            }}
          />
          <CommandList>
            <CommandEmpty>{search.entries.length === 0 ? "No earlier prompts" : "No matches"}</CommandEmpty>
            <CommandGroup>
              {found.map((entry, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- two prompts can share text and a time
                <CommandItem key={index} value={String(index)} onSelect={() => keep(entry)}>
                  <span className="min-w-0 flex-1 truncate">{entry.text.replaceAll(/\s+/gu, " ")}</span>
                  {entry.sentAt === undefined ? null : (
                    <CommandShortcut>{age(entry.sentAt, search.now)}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
