import { useState, type ReactElement, type ReactNode } from "react"
import { IconCube } from "@tabler/icons-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { useSpaces } from "../lib/use-spaces.js"
import { Picker } from "./picker.js"

export function SpacePicker(props: {
  value: string
  heading: string
  note?: string
  trigger: ReactElement
  children: ReactNode
  onChange: (spaceId: string) => void
}) {
  const spaces = useSpaces()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={props.trigger}>{props.children}</PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0 p-0">
        <Command label="Space" defaultValue={props.value} className={Picker.command}>
          <CommandInput placeholder="Search space…" />
          {props.note ? <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">{props.note}</p> : null}
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No spaces match.</CommandEmpty>
            <CommandGroup heading={props.heading}>
              {spaces.joined.map((space) => (
                <CommandItem
                  key={space.id}
                  value={space.id}
                  keywords={[space.name]}
                  className="gap-2"
                  data-checked={props.value === space.id}
                  onSelect={() => {
                    props.onChange(space.id)
                    setOpen(false)
                  }}
                >
                  <IconCube />
                  {space.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
