import { useState, type ComponentType } from "react"
import { IconFilter2, IconRestore, IconX } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { MenuSearch } from "./menu-search.js"

export type FilterProperty = {
  key: string
  label: string
  any: string
  icon: ComponentType
  single?: boolean | undefined
  options: {
    value: string
    label: string
    icon?: ComponentType<{ className?: string | undefined }> | undefined
    count?: number | undefined
  }[]
}

export type Filters = Record<string, string[]>

const row = "h-9 gap-3 px-3 data-highlighted:[&_svg]:text-foreground! data-popup-open:[&_svg]:text-foreground!"
const marked = "h-9 gap-2 pr-3 pl-8 *:data-[slot$=indicator]:right-auto *:data-[slot$=indicator]:left-2"

export function FilterMenu(props: {
  label: string
  properties: FilterProperty[]
  value: Filters
  onChange: (value: Filters) => void
  noun?: string | undefined
  trigger?: "toolbar" | "sidebar" | undefined
}) {
  const sidebar = props.trigger === "sidebar"
  const active = Object.values(props.value).some((values) => values.length > 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={sidebar ? "icon-sm" : "icon"}
            className={
              sidebar
                ? "relative size-5 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg:not([class*='size-'])]:size-4"
                : "relative text-muted-foreground"
            }
            aria-label={active ? `${props.label}, filters on` : props.label}
          />
        }
      >
        <IconFilter2 />
        {active ? (
          <span
            className={
              sidebar
                ? "absolute -top-0.5 -right-0.5 size-2 rounded-full bg-ring ring-2 ring-sidebar"
                : "absolute top-1 right-1 size-2 rounded-full bg-ring ring-2 ring-background"
            }
          />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={sidebar ? "start" : "end"} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="mb-1">Properties</DropdownMenuLabel>
          {props.properties.map((property) => {
            const selected = props.value[property.key] ?? []
            const set = (values: string[]) => props.onChange({ ...props.value, [property.key]: values })
            return (
              <DropdownMenuSub key={property.key}>
                <DropdownMenuSubTrigger className={row}>
                  <property.icon />
                  <span className="flex-1">{property.label}</span>
                  <span className="text-muted-foreground">{summary(property, selected)}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={2} className={props.noun ? "w-60" : "w-48"}>
                  {property.single ? (
                    <DropdownMenuRadioGroup
                      value={selected[0] ?? ""}
                      onValueChange={(value: string) => set(value ? [value] : [])}
                    >
                      {[{ value: "", label: property.any }, ...property.options].map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value} className={marked}>
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  ) : (
                    <CheckboxOptions property={property} selected={selected} onChange={set} noun={props.noun} />
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-0 my-2" />
        <DropdownMenuGroup>
          <DropdownMenuItem className={row} disabled={!active} onClick={() => props.onChange({})}>
            <IconRestore />
            Reset to default
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function summary(property: FilterProperty, selected: ReadonlyArray<string>) {
  if (selected.length === 0) return property.any
  if (selected.length === 1) return property.options.find((option) => option.value === selected[0])?.label
  return `${selected.length} selected`
}

function CheckboxOptions(props: {
  property: FilterProperty
  selected: string[]
  onChange: (values: string[]) => void
  noun?: string | undefined
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const options = props.property.options.filter((option) => option.label.toLowerCase().includes(needle))
  return (
    <>
      {props.property.options.length > 5 ? (
        <MenuSearch value={query} onChange={setQuery} placeholder="Filter…" />
      ) : null}
      {options.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">No results</div> : null}
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.value}
          checked={props.selected.includes(option.value)}
          className={marked}
          closeOnClick={false}
          onCheckedChange={(checked) =>
            props.onChange(
              checked ? [...props.selected, option.value] : props.selected.filter((value) => value !== option.value),
            )
          }
        >
          {option.icon ? <option.icon /> : null}
          <span className="flex-1 truncate">{option.label}</span>
          {props.noun && option.count !== undefined ? (
            <span className="text-xs text-muted-foreground">
              {option.count} {option.count === 1 ? props.noun : `${props.noun}s`}
            </span>
          ) : null}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  )
}

export const passes = (filters: Filters, values: Record<string, string[]>) =>
  Object.entries(filters).every(
    (entry) => entry[1].length === 0 || (values[entry[0]] ?? []).some((value) => entry[1].includes(value)),
  )

export function FilterChips(props: {
  properties: FilterProperty[]
  value: Filters
  onChange: (value: Filters) => void
}) {
  const on = props.properties.filter((property) => (props.value[property.key] ?? []).length > 0)
  if (on.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {on.map((property) => {
        const selected = props.value[property.key] ?? []
        const optionLabels = new Map(property.options.map((option) => [option.value, option.label]))
        const labels = selected.map((value) => optionLabels.get(value) ?? value)
        return (
          <div key={property.key} className="flex h-6.5 items-center divide-x rounded-md border text-xs">
            <span className="flex h-full items-center gap-1.5 px-2 text-muted-foreground [&_svg]:size-3.5">
              <property.icon />
              {property.label}
            </span>
            <span className="flex h-full items-center px-2 text-muted-foreground">
              {selected.length > 1 ? "is any of" : "is"}
            </span>
            <span className="flex h-full max-w-60 items-center truncate px-2">{labels.join(", ")}</span>
            <Button
              variant="ghost"
              aria-label={`Remove ${property.label} filter`}
              onClick={() => props.onChange({ ...props.value, [property.key]: [] })}
              className="h-full rounded-none rounded-r-md border-0 px-1.5 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5"
            >
              <IconX />
            </Button>
          </div>
        )
      })}
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => props.onChange({})}>
        Clear
      </Button>
    </div>
  )
}
