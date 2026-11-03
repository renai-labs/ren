import { IconSearch, IconX } from "@tabler/icons-react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@ren/ui/input-group"

export function ToolbarSearch(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <InputGroup className="h-8 w-56 border-0 bg-muted inset-ring inset-ring-transparent transition-colors hover:bg-secondary has-[[data-slot=input-group-control]:focus-visible]:inset-ring-ring dark:bg-muted">
      <InputGroupAddon className="pl-3">
        <IconSearch />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={props.value}
        placeholder={props.label}
        aria-label={props.label}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onChange("")
        }}
        className="h-full pl-1 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {props.value ? (
        <InputGroupAddon align="inline-end" className="pr-3">
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => props.onChange("")}
            className="size-4 rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <IconX />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}
