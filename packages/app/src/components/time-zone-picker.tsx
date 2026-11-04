import { useState } from "react"
import { IconChevronDown, IconWorld } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { cn } from "cn"
import { localTimeZone, timeZones } from "../lib/schedules.js"
import { MenuSearch } from "./menu-search.js"

const readable = (zone: string) => zone.replaceAll("_", " ")

export function TimeZonePicker(props: {
  value: string
  onChange: (value: string) => void
  automatic?: boolean | undefined
  variant?: "outline" | "ghost" | undefined
  className?: string | undefined
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase().replaceAll(" ", "_")
  const matches = timeZones().filter((zone) => zone.toLowerCase().includes(needle))
  const label =
    props.automatic && props.value === "" ? `Automatic · ${readable(localTimeZone())}` : readable(props.value)
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setQuery("")
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant={props.variant ?? "outline"}
            className={cn("justify-between font-normal", props.className)}
            aria-label={`Timezone: ${label}`}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <IconWorld className="text-muted-foreground" />
          <span className="truncate">{label}</span>
        </span>
        <IconChevronDown data-icon="inline-end" className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72">
        <MenuSearch value={query} onChange={setQuery} placeholder="Search timezones…" />
        {matches.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No timezones match “{query.trim()}”</p>
        ) : null}
        <DropdownMenuRadioGroup value={props.value} onValueChange={(value: string) => props.onChange(value)}>
          {props.automatic && !needle ? (
            <>
              <DropdownMenuRadioItem value="" closeOnClick>
                Automatic · {readable(localTimeZone())}
              </DropdownMenuRadioItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {matches.map((zone) => (
            <DropdownMenuRadioItem key={zone} value={zone} closeOnClick>
              {readable(zone)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
