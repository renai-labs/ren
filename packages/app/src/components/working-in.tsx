import { useRef, useState, type KeyboardEvent } from "react"
import type { SpaceInfo } from "@ren/client"
import { IconChevronDown, IconCube, IconLock } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"
import { PaletteDialog, PaletteEmpty, PaletteHeading, PaletteRow } from "./palette.js"

const isPersonal = (space: SpaceInfo) => space.kind === "private"

function SpaceIcon(props: { space: SpaceInfo }) {
  return isPersonal(props.space) ? <IconLock /> : <IconCube />
}

export function WorkingIn(props: {
  spaces: ReadonlyArray<SpaceInfo>
  spaceId: string | undefined
  disabled?: boolean | undefined
  label?: string | null | undefined
  className?: string | undefined
  onChange: (spaceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState<string>()
  const list = useRef<HTMLDivElement>(null)
  const chosen = props.spaces.find((space) => space.id === props.spaceId)
  const matches = props.spaces.filter((space) => space.name.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = [
    { label: "Personal", spaces: matches.filter(isPersonal) },
    { label: "Shared", spaces: matches.filter((space) => !isPersonal(space)) },
  ].filter((group) => group.spaces.length > 0)
  const rows = groups.flatMap((group) => group.spaces)
  const current =
    rows.find((space) => space.id === active) ?? rows.find((space) => space.id === props.spaceId) ?? rows[0]
  const pick = (space: SpaceInfo) => {
    setOpen(false)
    props.onChange(space.id)
  }
  const move = (delta: number) => {
    if (rows.length === 0) return
    const next = rows.at(((current ? rows.indexOf(current) : -1) + delta + rows.length) % rows.length)
    if (!next) return
    setActive(next.id)
    requestAnimationFrame(() =>
      list.current?.querySelector(`[data-row="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" }),
    )
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      move(event.key === "ArrowDown" ? 1 : -1)
    }
    if (event.key === "Enter" && current && !event.nativeEvent.isComposing) {
      event.preventDefault()
      pick(current)
    }
  }
  return (
    <span className={cn("ml-2 flex items-center gap-0.5 self-start text-sm text-muted-foreground", props.className)}>
      {props.label === null ? null : (props.label ?? "Working in")}
      <Button
        variant="ghost"
        disabled={props.disabled}
        aria-haspopup="dialog"
        className="px-1 font-normal text-muted-foreground"
        aria-label={`Destination: ${chosen?.name ?? "Choose a space"}`}
        onClick={() => {
          setQuery("")
          setActive(undefined)
          setOpen(true)
        }}
      >
        {chosen ? <SpaceIcon space={chosen} /> : <IconCube />}
        <span className="text-foreground">{chosen?.name ?? "Choose a space"}</span>
        <IconChevronDown />
      </Button>
      <PaletteDialog
        open={open}
        onOpenChange={setOpen}
        title="Choose space"
        search={{
          value: query,
          label: "Search spaces",
          onChange: (value) => {
            setQuery(value)
            setActive(undefined)
          },
          onKeyDown,
        }}
        className="max-h-[min(--spacing(120),calc(100dvh-(--spacing(24))))]"
      >
        <div
          ref={list}
          className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
        >
          {rows.length === 0 ? <PaletteEmpty>No spaces match “{query.trim()}”</PaletteEmpty> : null}
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <PaletteHeading>{group.label}</PaletteHeading>
              {group.spaces.map((space) => (
                <PaletteRow
                  key={space.id}
                  id={space.id}
                  active={current?.id === space.id}
                  selected={space.id === props.spaceId}
                  icon={<SpaceIcon space={space} />}
                  onPoint={() => setActive(space.id)}
                  onPick={() => pick(space)}
                >
                  <span className="min-w-0 truncate">{space.name}</span>
                </PaletteRow>
              ))}
            </div>
          ))}
        </div>
      </PaletteDialog>
    </span>
  )
}
