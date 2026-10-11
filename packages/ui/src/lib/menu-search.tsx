import { Icon } from "../components/icon.js"

export type SearchProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  onSubmit?: () => void
}

export function Search(props: SearchProps) {
  const placeholder = props.placeholder ?? "Search"
  return (
    <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 flex shrink-0 items-center gap-2 border-b border-border-primary bg-background-secondary px-3 text-text-secondary [&_svg]:size-4">
      <Icon glyph="Search" />
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the menu just opened, and typing should filter it straight away
        autoFocus
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") return
          if (event.key === "Enter" && props.onSubmit) {
            event.preventDefault()
            props.onSubmit()
          }
          if (event.key === "ArrowDown") {
            event.preventDefault()
            event.currentTarget
              .closest<HTMLElement>("[data-slot=menu]")
              ?.querySelector<HTMLElement>("[data-slot=menu-item]:not([data-disabled])")
              ?.focus()
          }
          event.stopPropagation()
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        // oxlint-disable-next-line ren/require-companion-class -- the field holds focus while the menu is open; arrow keys move it to the items
        className="h-10 w-full min-w-0 bg-transparent text-sm placeholder-muted text-text-primary outline-none max-sm:text-base"
      />
    </div>
  )
}
