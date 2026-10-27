import { useState } from "react"
import { IconSearch, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

export function ExpandableSearch(props: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (!open && !props.value) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={props.label}
        onClick={() => setOpen(true)}
      >
        <IconSearch />
      </Button>
    )
  }
  return (
    <InputGroup className="h-7 w-52 border-0 bg-muted inset-ring inset-ring-transparent transition-colors hover:bg-secondary has-[[data-slot=input-group-control]:focus-visible]:inset-ring-ring dark:bg-muted">
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
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onChange("")}
            className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <IconX className="size-3" />
          </button>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}
