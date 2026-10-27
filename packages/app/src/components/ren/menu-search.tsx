import { IconSearch } from "@tabler/icons-react"
import { Input } from "@/components/ui/input"
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu"

export function MenuSearch(props: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <>
      <div className="relative">
        <IconSearch className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key.length === 1) event.stopPropagation()
          }}
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          className="h-10 border-0 bg-transparent pl-8 focus-visible:ring-0"
        />
      </div>
      <DropdownMenuSeparator className="mt-0" />
    </>
  )
}
