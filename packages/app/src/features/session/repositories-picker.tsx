import { useRef, useState, type KeyboardEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconChevronDown, IconPlus } from "@tabler/icons-react"
import { Repositories } from "@ren/chat"
import { SpaceRepositories } from "@ren/client/react"
import { Button } from "@ren/ui/button"
import { toast } from "@ren/ui/sonner"
import { Search } from "@ren/schema/search"
import { AddRepositoriesDialog } from "../../components/add-repositories-dialog.js"
import { PaletteDialog, PaletteEmpty, PaletteHeading, PaletteRow } from "../../components/palette.js"
import { GitHubMark } from "../../icons/brands.js"
import { RouterContext } from "../../lib/router-context.js"

export function RepositoriesDialog(props: { spaceId: string; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const space = SpaceRepositories.useReferences(api, props.spaceId)
  if (space.pending) return null
  return (
    <AddRepositoriesDialog
      existing={space.references}
      saving={space.saving}
      error={space.error}
      onAdd={(added) =>
        space.add(added).then(() => {
          toast.success(added.length > 1 ? `${added.length} repositories added` : "Repository added")
          props.onClose()
        })
      }
      onClose={props.onClose}
    />
  )
}

type Reference = Repositories.Info

type Row = { readonly key: string; readonly reference: Reference } | { readonly key: "add"; readonly reference: null }

const keyOf = (reference: Reference) => `repository:${reference.alias}`

function RepositoriesPalette(props: {
  references: ReadonlyArray<Reference>
  canAdd: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: () => void
}) {
  const { platform } = RouterContext.useRouterContext()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState<string>()
  const list = useRef<HTMLDivElement>(null)
  const matches = props.references.filter((reference) =>
    Search.matches(query, Repositories.nameOf(reference.repository), reference.alias),
  )
  const rows: ReadonlyArray<Row> = [
    ...matches.map((reference) => ({ key: keyOf(reference), reference })),
    ...(props.canAdd ? [{ key: "add" as const, reference: null }] : []),
  ]
  const current = rows.find((row) => row.key === active) ?? rows[0]
  const pick = (row: Row) => {
    props.onOpenChange(false)
    if (row.reference) platform.openExternal(row.reference.repository)
    else props.onAdd()
  }
  const move = (delta: number) => {
    if (rows.length === 0) return
    const next = rows.at(((current ? rows.indexOf(current) : -1) + delta + rows.length) % rows.length)
    if (!next) return
    setActive(next.key)
    requestAnimationFrame(() =>
      list.current?.querySelector(`[data-row="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: "nearest" }),
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
    <PaletteDialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) {
          setQuery("")
          setActive(undefined)
        }
        props.onOpenChange(open)
      }}
      title="Repositories"
      search={{
        value: query,
        label: "Search repositories",
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
        {matches.length === 0 ? <PaletteEmpty>No repositories match “{query.trim()}”</PaletteEmpty> : null}
        {matches.length > 0 ? <PaletteHeading>In this space</PaletteHeading> : null}
        {rows.map((row) => (
          <PaletteRow
            key={row.key}
            id={row.key}
            active={current?.key === row.key}
            selected={false}
            icon={row.reference ? <GitHubMark /> : <IconPlus />}
            onPoint={() => setActive(row.key)}
            onPick={() => pick(row)}
          >
            {row.reference ? (
              <>
                <span className="min-w-0 truncate">{Repositories.nameOf(row.reference.repository)}</span>
                {row.reference.branch ? (
                  <span className="shrink-0 text-muted-foreground">{row.reference.branch}</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Add repository</span>
            )}
          </PaletteRow>
        ))}
      </div>
    </PaletteDialog>
  )
}

export function RepositoriesPicker(props: { spaceId: string | undefined; disabled?: boolean | undefined }) {
  const { api } = RouterContext.useRouterContext()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const settings = useQuery({
    ...api["space-settings"].get.queryOptions({ idOrSlug: props.spaceId ?? "" }),
    enabled: props.spaceId !== undefined,
  })
  const references = settings.data?.settings.references ?? []
  const first = references.at(0)
  if (!props.spaceId || !first) return null
  const spaceId = props.spaceId
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <Button
        variant="ghost"
        disabled={props.disabled}
        aria-haspopup="dialog"
        className="px-1 font-normal text-muted-foreground"
        aria-label={`Repositories: ${references.map((reference) => reference.alias).join(", ")}`}
        onClick={() => setOpen(true)}
      >
        <GitHubMark className="size-4" />
        <span className="max-w-40 truncate text-foreground">{Repositories.nameOf(first.repository)}</span>
        {references.length > 1 ? <span className="tabular-nums">+{references.length - 1}</span> : null}
        <IconChevronDown />
      </Button>
      <RepositoriesPalette
        references={references}
        canAdd={settings.data?.canUpdate === true}
        open={open}
        onOpenChange={setOpen}
        onAdd={() => setAdding(true)}
      />
      {adding ? <RepositoriesDialog spaceId={spaceId} onClose={() => setAdding(false)} /> : null}
    </>
  )
}
