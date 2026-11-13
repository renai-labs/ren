import { useState } from "react"
import { IconBuilding, IconCube, IconLock, IconSearch } from "@tabler/icons-react"
import { Field, FieldLabel } from "@ren/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Switch } from "@ren/ui/switch"
import { cn } from "cn"
import { Search } from "../lib/search.js"
import { useScrollEdges } from "../lib/use-scroll-edges.js"

export function SpacesField(props: {
  spaces: ReadonlyArray<{ id: string; name: string }>
  picked: ReadonlySet<string>
  onPick: (picked: ReadonlySet<string>) => void
  locked?: ReadonlySet<string> | undefined
  every?: { checked: boolean; onChange: (checked: boolean) => void } | undefined
}) {
  const row = "flex h-11 shrink-0 items-center justify-between gap-3 px-3"
  const [listRef, edges] = useScrollEdges({ axis: "y" })
  const [query, setQuery] = useState("")
  const every = props.every
  const shown = props.spaces.filter((space) => Search.matches(query, space.name))
  return (
    <Field className="text-left">
      <FieldLabel>Spaces</FieldLabel>
      <div className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
        <InputGroup className="h-11 rounded-none border-0 bg-transparent shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search spaces"
            placeholder="Design"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        {every ? (
          <div className={row}>
            <FieldLabel htmlFor="spaces-every" className="flex-1 font-normal">
              <IconBuilding className="size-4 shrink-0 text-muted-foreground" />
              Every space
            </FieldLabel>
            <Switch id="spaces-every" checked={every.checked} onCheckedChange={(checked) => every.onChange(checked)} />
          </div>
        ) : null}
        <div
          ref={listRef}
          className={cn(
            "flex max-h-38.5 scrollbar-thin flex-col divide-y overflow-y-auto overscroll-contain",
            edges.start && edges.end && "mask-y-from-65%",
            edges.start && !edges.end && "mask-t-from-65%",
            !edges.start && edges.end && "mask-b-from-65%",
          )}
        >
          {shown.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No spaces match “{query}”</p> : null}
          {shown.map((space) => {
            const locked = props.locked?.has(space.id) ?? false
            return (
              <div key={space.id} className={row}>
                <FieldLabel htmlFor={`spaces-${space.id}`} className="min-w-0 flex-1 font-normal">
                  <IconCube className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{space.name}</span>
                  {locked ? <IconLock className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                </FieldLabel>
                <Switch
                  id={`spaces-${space.id}`}
                  disabled={locked || every?.checked}
                  checked={locked || Boolean(every?.checked) || props.picked.has(space.id)}
                  onCheckedChange={(checked) => {
                    const next = new Set(props.picked)
                    if (checked) next.add(space.id)
                    else next.delete(space.id)
                    props.onPick(next)
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </Field>
  )
}
