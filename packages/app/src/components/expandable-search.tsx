import { useState } from "react"
import { IconSearch, IconX } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@ren/ui/input-group"

export function ExpandableSearch(props: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!open && !props.value) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground"
        aria-label={props.label}
        onClick={() => setOpen(true)}
      >
        <IconSearch />
      </Button>
    )
  }
  return (
    <InputGroup className="h-8 w-52 border-0 bg-muted inset-ring inset-ring-transparent transition-colors hover:bg-secondary has-[[data-slot=input-group-control]:focus-visible]:inset-ring-ring dark:bg-muted">
      <InputGroupAddon className="pl-3">
        <IconSearch />
      </InputGroupAddon>
      <InputGroupInput
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the person asked to search
        autoFocus
        type="search"
        value={props.value}
        placeholder={props.label}
        aria-label={props.label}
        onChange={(event) => props.onChange(event.target.value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          props.onChange("")
          setOpen(false)
        }}
        className="h-full pl-1 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {props.value ? (
        <InputGroupAddon align="inline-end" className="pr-3">
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear search"
            onMouseDown={(event) => event.preventDefault()}
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
