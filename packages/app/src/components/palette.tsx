import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { IconCheck, IconSearch } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogTitle } from "@ren/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { cn } from "cn"

const motion =
  "duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] data-open:zoom-in-[0.97] data-open:slide-in-from-top-1 data-closed:duration-150 data-closed:ease-in data-closed:zoom-out-[0.98] motion-reduce:data-open:zoom-in-100 motion-reduce:data-open:slide-in-from-top-0 motion-reduce:data-closed:zoom-out-100"

export function PaletteDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  search: {
    readonly value: string
    readonly label: string
    readonly onChange: (value: string) => void
    readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  }
  className?: string | undefined
  children: ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const search = props.search
  return (
    <Dialog open={props.open} onOpenChange={(open: boolean) => props.onOpenChange(open)}>
      <DialogContent
        showCloseButton={false}
        initialFocus={input}
        data-dialog="palette"
        overlayClassName="duration-200 data-closed:duration-150"
        className={cn("flex flex-col gap-0 overflow-hidden p-0 sm:max-w-120", motion, props.className)}
      >
        <DialogTitle className="sr-only">{props.title}</DialogTitle>
        <div className="flex shrink-0 flex-col gap-1.5 px-1.5 pt-1.5">
          <InputGroup className="h-7 border-0 bg-transparent shadow-none dark:bg-transparent">
            <InputGroupAddon className="pl-1.5">
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              ref={input}
              value={search.value}
              aria-label={search.label}
              placeholder={search.label}
              spellCheck={false}
              autoComplete="off"
              className="h-7"
              onChange={(event) => search.onChange(event.target.value)}
              onKeyDown={search.onKeyDown}
            />
          </InputGroup>
          <div aria-hidden className="-mx-1.5 h-px bg-border" />
        </div>
        {props.children}
      </DialogContent>
    </Dialog>
  )
}

export function PaletteHeading(props: { children: ReactNode }) {
  return (
    <h3 className="sticky top-0 z-10 -mx-1.5 bg-background pt-4 pr-1.5 pb-0.5 pl-8.5 text-xs/4.5 font-normal text-muted-foreground select-none">
      {props.children}
    </h3>
  )
}

export function PaletteEmpty(props: { children: ReactNode }) {
  return <div className="grid min-h-30 place-items-center text-sm text-muted-foreground">{props.children}</div>
}

export function PaletteRow(props: {
  id: string
  active: boolean
  selected: boolean
  icon?: ReactNode
  children: ReactNode
  onPoint: () => void
  onPick: () => void
}) {
  return (
    // oxlint-disable-next-line react/forbid-elements -- a palette row, laid out as OpenCode's model list
    <button
      type="button"
      data-row={props.id}
      data-active={props.active || undefined}
      aria-current={props.selected || undefined}
      tabIndex={-1}
      className="flex h-7 w-full shrink-0 scroll-mt-8 items-center gap-1.5 rounded-md pr-0.75 pl-1.5 text-left text-sm outline-none focus-visible:bg-foreground/6 data-active:bg-foreground/6"
      onMouseMove={(event) => {
        if (event.movementX !== 0 || event.movementY !== 0) props.onPoint()
      }}
      onClick={props.onPick}
    >
      <span className="flex w-4 shrink-0 justify-center">
        {props.selected ? <IconCheck className="size-3 text-muted-foreground" /> : null}
      </span>
      {props.icon ? (
        <span className="flex shrink-0 text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5">{props.icon}</span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">{props.children}</span>
    </button>
  )
}
