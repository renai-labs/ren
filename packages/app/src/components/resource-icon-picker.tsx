import { Suspense, use, useDeferredValue, useRef, useState, type ReactNode } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconPhotoUp, IconSearch, IconTrash } from "@tabler/icons-react"
import { ResourceIcon } from "@ren/schema/resource-icon"
import { Button } from "@ren/ui/button"
import { Empty, EmptyContent, EmptyDescription } from "@ren/ui/empty"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ren/ui/popover"
import { Spinner } from "@ren/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { cn } from "cn"
import { errorMessage } from "../lib/errors.js"
import { ResourceIcons } from "../lib/resource-icons.js"
import { RouterContext } from "../lib/router-context.js"
import { FileDrop } from "../platform/file-drop.js"
import { ResourceAvatar } from "./resource-avatar.js"

const imageTypes: ReadonlySet<string> = new Set(ResourceIcon.uploadTypes)

const tabs = { tabler: "icons", emoji: "emoji", image: "upload" } as const

type Tab = (typeof tabs)[keyof typeof tabs]

const tabValues: ReadonlyArray<Tab> = Object.values(tabs)

const emojiGroups: ReadonlySet<number> = new Set([0, 1, 3, 4, 5, 6, 7, 8])

interface Emoji {
  readonly unicode: string
  readonly label: string
  readonly tags: ReadonlyArray<string>
}

let emojis: Promise<ReadonlyArray<Emoji>> | undefined

const loadEmojis = () => {
  emojis ??= import("emojibase-data/en/compact.json").then((data) =>
    data.default
      .filter((entry) => entry.group !== undefined && emojiGroups.has(entry.group))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((entry) => ({ unicode: entry.unicode, label: entry.label, tags: entry.tags ?? [] })),
  )
  return emojis
}

const refusal = (file: File) =>
  (!imageTypes.has(file.type) && ResourceIcon.uploadUnreadable) ||
  (file.size > ResourceIcon.maximumUploadBytes && ResourceIcon.uploadTooLarge) ||
  null

function SearchField(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <IconSearch />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={props.label}
        placeholder="rocket"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </InputGroup>
  )
}

function Glyphs(props: {
  color: ResourceIcon.Color
  value: string | null | undefined
  disabled: boolean
  onPick: (icon: string) => void
}) {
  const [query, setQuery] = useState("")
  const search = useDeferredValue(query.trim().toLowerCase())
  const shown = search
    ? ResourceIcons.glyphs.filter(
        (glyph) => glyph.label.toLowerCase().includes(search) || glyph.keywords.includes(search),
      )
    : ResourceIcons.glyphs
  return (
    <div className="flex flex-col gap-2">
      <SearchField label="Search icons" value={query} onChange={setQuery} />
      <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto overscroll-contain">
        {shown.map((glyph) => {
          const icon = ResourceIcon.tablerOf(glyph.name, props.color)
          return (
            <Button
              key={glyph.name}
              variant="ghost"
              size="icon"
              aria-label={glyph.label}
              aria-pressed={props.value === icon}
              className="aria-pressed:ring-2 aria-pressed:ring-ring"
              disabled={props.disabled}
              onClick={() => props.onPick(icon)}
            >
              <ResourceAvatar icon={icon} fallback={null} className="size-7 rounded-md" />
            </Button>
          )
        })}
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No icon matches “{query}”.</p> : null}
    </div>
  )
}

function EmojiGrid(props: { search: string; disabled: boolean; onPick: (icon: string) => void }) {
  const all = use(loadEmojis())
  const shown = props.search
    ? all.filter((emoji) => emoji.label.includes(props.search) || emoji.tags.some((tag) => tag.includes(props.search)))
    : all
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">No emoji matches “{props.search}”.</p>
  return (
    <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain">
      {shown.map((emoji) => (
        <Button
          key={emoji.unicode}
          variant="ghost"
          size="icon-sm"
          aria-label={emoji.label}
          className="text-lg"
          disabled={props.disabled}
          onClick={() => props.onPick(ResourceIcon.emojiOf(emoji.unicode))}
        >
          {emoji.unicode}
        </Button>
      ))}
    </div>
  )
}

function Emojis(props: { disabled: boolean; onPick: (icon: string) => void }) {
  const [query, setQuery] = useState("")
  const search = useDeferredValue(query.trim().toLowerCase())
  return (
    <div className="flex flex-col gap-2">
      <SearchField label="Search emoji" value={query} onChange={setQuery} />
      <Suspense
        fallback={
          <div className="flex h-56 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <EmojiGrid search={search} disabled={props.disabled} onPick={props.onPick} />
      </Suspense>
    </div>
  )
}

function Upload(props: { busy: boolean; onFile: (file: File | undefined) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const dragging = FileDrop.useEntries((entries) => {
    void entries.then((dropped) => props.onFile(dropped.at(0)?.files.at(0)?.file))
  })
  return (
    <Empty
      className={cn("gap-3 border p-4 transition-colors duration-150 ease-out", dragging && "border-ring bg-muted/50")}
    >
      <EmptyDescription className="flex items-center gap-2">
        {props.busy ? <Spinner /> : null}
        {dragging ? "Drop to use this image" : "Drop an image here. PNG, JPEG or WebP, up to 512 KB."}
      </EmptyDescription>
      <EmptyContent>
        <Button type="button" variant="outline" size="sm" disabled={props.busy} onClick={() => picker.current?.click()}>
          <IconPhotoUp data-icon="inline-start" />
          Choose image
        </Button>
        <Input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.item(0) ?? undefined
            event.currentTarget.value = ""
            props.onFile(file)
          }}
        />
      </EmptyContent>
    </Empty>
  )
}

export function ResourceIconPicker(props: {
  label: string
  value: string | null | undefined
  className?: string | undefined
  disabled?: boolean | undefined
  onChange: (value: string | null) => Promise<unknown>
  children: ReactNode
}) {
  const { api } = RouterContext.useRouterContext()
  const upload = useMutation(api.icon.upload.mutationOptions())
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const current = ResourceIcon.parse(props.value)
  const [color, setColor] = useState<ResourceIcon.Color>(current?.type === "tabler" ? current.color : "neutral")
  const [tab, setTab] = useState<Tab>(tabs[current?.type ?? "tabler"])
  const save = (value: string | null) => {
    setSaving(true)
    setProblem(null)
    void props
      .onChange(value)
      .then(
        () => setOpen(false),
        (error: unknown) => setProblem(errorMessage(error, "Couldn’t save the picture. Try again.")),
      )
      .finally(() => setSaving(false))
  }
  const busy = saving || upload.isPending
  const take = (file: File | undefined) => {
    if (!file || busy) return
    const refused = refusal(file)
    setProblem(refused)
    if (refused) return
    void upload.mutateAsync({ payload: file }).then(
      (uploaded) => save(uploaded.url),
      (error: unknown) => setProblem(errorMessage(error, "The upload failed. Try again.")),
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={props.disabled}
        render={
          <Button
            variant="ghost"
            className={cn("size-9 p-0 transition-transform duration-150 ease-out active:scale-95", props.className)}
            aria-label={`Change ${props.label.toLowerCase()}`}
          />
        }
      >
        {props.children}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle className="text-sm font-medium">{props.label}</PopoverTitle>
          {props.value ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={busy}
              onClick={() => save(null)}
            >
              <IconTrash data-icon="inline-start" />
              Remove
            </Button>
          ) : null}
        </div>
        <Tabs
          value={tab}
          onValueChange={(next: unknown) => {
            const chosen = tabValues.find((each) => each === next)
            if (chosen) setTab(chosen)
          }}
          className="gap-3"
        >
          <TabsList className="w-full">
            <TabsTrigger value="icons">Icons</TabsTrigger>
            <TabsTrigger value="emoji">Emoji</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
          </TabsList>
          <TabsContent value="icons" className="flex flex-col gap-2">
            <ToggleGroup
              aria-label="Colour"
              spacing={1}
              value={[color]}
              onValueChange={(value: ReadonlyArray<string>) => {
                const next = ResourceIcon.colors.find((each) => each === value.at(0))
                if (next) setColor(next)
              }}
            >
              {ResourceIcon.colors.map((each) => (
                <ToggleGroupItem
                  key={each}
                  value={each}
                  aria-label={`${each.charAt(0).toUpperCase()}${each.slice(1)}`}
                  className="size-7 min-w-0 rounded-full p-0 data-pressed:ring-2 data-pressed:ring-ring"
                >
                  <span className={cn("size-5 rounded-full", ResourceIcons.tiles[each])} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Glyphs color={color} value={props.value} disabled={busy} onPick={save} />
          </TabsContent>
          <TabsContent value="emoji">
            <Emojis disabled={busy} onPick={save} />
          </TabsContent>
          <TabsContent value="upload">
            <Upload busy={busy} onFile={take} />
          </TabsContent>
        </Tabs>
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
