import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import type { ReactNode } from "react"

export interface FilterOption {
  readonly value: string
  readonly label: string
  readonly icon?: ReactNode
}

export interface FilterProperty {
  readonly key: string
  readonly label: string
  readonly icon: ReactNode
  readonly options: ReadonlyArray<FilterOption>
}

export function FilterMenu(props: {
  label: string
  properties: ReadonlyArray<FilterProperty>
  values: Readonly<Record<string, ReadonlyArray<string>>>
  modified: boolean
  onToggle: (change: { key: string; value: string; checked: boolean }) => void
  onReset: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative text-muted-foreground"
            aria-label={props.modified ? `${props.label}, filters on` : props.label}
          />
        }
      >
        <Icon glyph="ListFilter" />
        {props.modified ? (
          <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-ring ring-2 ring-background" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="mb-1">Properties</DropdownMenuLabel>
          {props.properties.map((property) => {
            const values = props.values[property.key] ?? []
            return (
              <DropdownMenuSub key={property.key}>
                <DropdownMenuSubTrigger className="h-9 gap-3 px-3">
                  {property.icon}
                  <span className="flex-1">{property.label}</span>
                  <span className="text-muted-foreground">
                    {values.length > 0 ? `${values.length} selected` : "Any"}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-60">
                  {property.options.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
                  ) : (
                    <DropdownMenuGroup>
                      {property.options.map((option) => (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={values.includes(option.value)}
                          onCheckedChange={(checked) =>
                            props.onToggle({ key: property.key, value: option.value, checked })
                          }
                        >
                          {option.icon}
                          {option.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-0 my-2" />
        <DropdownMenuGroup>
          <DropdownMenuItem className="h-9 gap-3 px-3" disabled={!props.modified} onClick={props.onReset}>
            <Icon glyph="Restore" />
            Reset to default
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
