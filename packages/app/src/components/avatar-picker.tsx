import { useRef, useState, type ReactElement } from "react"
import { IconPhotoUp, IconTrash } from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ren/ui/popover"
import { Separator } from "@ren/ui/separator"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"

const svg = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`

const gradient = (from: string, to: string, body: string) =>
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/>${body}`

const people = [
  [
    "Sunrise",
    gradient(
      "#ffb36b",
      "#ff6f91",
      `<circle cx="32" cy="38" r="13" fill="#fff" opacity=".9"/><rect y="40" width="64" height="24" fill="#c2416b" opacity=".55"/>`,
    ),
  ],
  [
    "Orbit",
    gradient(
      "#6a8dff",
      "#8b5cf6",
      `<circle cx="32" cy="32" r="13" fill="none" stroke="#fff" stroke-width="3.5" opacity=".85"/><circle cx="44" cy="21" r="4.5" fill="#fff"/>`,
    ),
  ],
  [
    "Tide",
    gradient(
      "#38bdf8",
      "#0f766e",
      `<path d="M0 36q8-6 16 0t16 0 16 0 16 0v28H0z" fill="#fff" opacity=".35"/><path d="M0 46q8-6 16 0t16 0 16 0 16 0v18H0z" fill="#fff" opacity=".6"/>`,
    ),
  ],
  [
    "Peaks",
    gradient(
      "#a7f3d0",
      "#10b981",
      `<path d="M0 50 20 26l12 14 10-10 22 22v12H0z" fill="#065f46" opacity=".7"/><circle cx="46" cy="18" r="5" fill="#fff" opacity=".9"/>`,
    ),
  ],
  [
    "Bloom",
    gradient(
      "#fbcfe8",
      "#ec4899",
      `<circle cx="24" cy="26" r="11" fill="#fff" opacity=".55"/><circle cx="40" cy="26" r="11" fill="#fff" opacity=".55"/><circle cx="32" cy="40" r="11" fill="#fff" opacity=".55"/>`,
    ),
  ],
  [
    "Prism",
    gradient(
      "#fde68a",
      "#f59e0b",
      `<path d="M32 14 50 46H14z" fill="#fff" opacity=".85"/><path d="M32 14 50 46H32z" fill="#b45309" opacity=".35"/>`,
    ),
  ],
  [
    "Dusk",
    gradient(
      "#312e81",
      "#7c3aed",
      `<circle cx="38" cy="26" r="11" fill="#fde68a"/><circle cx="44" cy="22" r="10" fill="#4c1d95"/><circle cx="18" cy="20" r="1.5" fill="#fff"/><circle cx="24" cy="44" r="1.2" fill="#fff"/><circle cx="48" cy="44" r="1.5" fill="#fff"/>`,
    ),
  ],
  [
    "Grid",
    gradient(
      "#e2e8f0",
      "#94a3b8",
      `<g fill="#334155" opacity=".75"><circle cx="20" cy="20" r="4"/><circle cx="32" cy="20" r="4"/><circle cx="44" cy="20" r="4"/><circle cx="20" cy="32" r="4"/><circle cx="44" cy="32" r="4"/><circle cx="20" cy="44" r="4"/><circle cx="32" cy="44" r="4"/><circle cx="44" cy="44" r="4"/></g><circle cx="32" cy="32" r="4" fill="#f97316"/>`,
    ),
  ],
  [
    "Split",
    gradient(
      "#fda4af",
      "#e11d48",
      `<path d="M64 0v64H0z" fill="#fff" opacity=".28"/><circle cx="32" cy="32" r="9" fill="#fff" opacity=".9"/>`,
    ),
  ],
  [
    "Leaf",
    gradient(
      "#d9f99d",
      "#65a30d",
      `<path d="M18 46c0-18 12-28 30-28 0 18-10 30-28 30z" fill="#fff" opacity=".85"/><path d="M20 46 40 26" stroke="#4d7c0f" stroke-width="2.5" stroke-linecap="round"/>`,
    ),
  ],
  [
    "Arcade",
    gradient(
      "#a5f3fc",
      "#0891b2",
      `<path d="M14 44a18 18 0 0 1 36 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M22 44a10 10 0 0 1 20 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/>`,
    ),
  ],
  [
    "Smile",
    gradient(
      "#fef08a",
      "#facc15",
      `<circle cx="25" cy="28" r="3" fill="#713f12"/><circle cx="39" cy="28" r="3" fill="#713f12"/><path d="M23 38q9 8 18 0" fill="none" stroke="#713f12" stroke-width="3" stroke-linecap="round"/>`,
    ),
  ],
] as const

const mark = (color: string, body: string) =>
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="64" height="64" fill="${color}"/><rect width="64" height="64" fill="url(#g)"/><g fill="#fff" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">${body}</g>`

const organizations = [
  ["Hexagon", mark("#4f46e5", `<path d="M32 15 47 23.5v17L32 49 17 40.5v-17z" fill="none" stroke-width="5"/>`)],
  [
    "Rise",
    mark(
      "#059669",
      `<rect x="17" y="34" width="7" height="13" rx="2" stroke="none"/><rect x="28.5" y="26" width="7" height="21" rx="2" stroke="none"/><rect x="40" y="17" width="7" height="30" rx="2" stroke="none"/>`,
    ),
  ],
  [
    "Rings",
    mark(
      "#0284c7",
      `<circle cx="32" cy="32" r="15" fill="none" stroke-width="4"/><circle cx="32" cy="32" r="6" stroke="none"/>`,
    ),
  ],
  [
    "Spark",
    mark("#ea580c", `<path d="M32 14v36M14 32h36M19.5 19.5l25 25M44.5 19.5l-25 25" fill="none" stroke-width="5"/>`),
  ],
  [
    "Bauhaus",
    mark(
      "#e11d48",
      `<path d="M16 32a16 16 0 0 1 32 0z" stroke="none"/><rect x="16" y="35" width="13" height="13" rx="2" stroke="none"/><circle cx="41.5" cy="41.5" r="6.5" stroke="none"/>`,
    ),
  ],
  ["Peak", mark("#7c3aed", `<path d="M14 46 28 22l7 12 5-7 10 19z" stroke="none"/>`)],
  [
    "Blocks",
    mark(
      "#0f172a",
      `<rect x="16" y="16" width="14" height="14" rx="3" stroke="none"/><rect x="34" y="16" width="14" height="14" rx="7" stroke="none" opacity=".55"/><rect x="16" y="34" width="14" height="14" rx="7" stroke="none" opacity=".55"/><rect x="34" y="34" width="14" height="14" rx="3" stroke="none"/>`,
    ),
  ],
  [
    "Wave",
    mark(
      "#0d9488",
      `<path d="M14 26q4.5-6 9 0t9 0 9 0 9 0M14 38q4.5-6 9 0t9 0 9 0 9 0" fill="none" stroke-width="4.5"/>`,
    ),
  ],
  [
    "Diamond",
    mark(
      "#d97706",
      `<path d="M32 14 50 32 32 50 14 32z" fill="none" stroke-width="5"/><path d="M32 25 39 32 32 39 25 32z" stroke="none"/>`,
    ),
  ],
  ["Bolt", mark("#2563eb", `<path d="M35 13 19 36h12l-3 15 17-24H33z" stroke="none"/>`)],
  [
    "Loop",
    mark(
      "#c026d3",
      `<path d="M20 32a7 7 0 1 1 12 0 7 7 0 1 0 12 0 7 7 0 1 0-12 0 7 7 0 1 1-12 0" fill="none" stroke-width="4.5"/>`,
    ),
  ],
  [
    "Stack",
    mark(
      "#334155",
      `<path d="M32 15 50 24 32 33 14 24z" stroke="none"/><path d="M14 32l18 9 18-9M14 40l18 9 18-9" fill="none" stroke-width="4"/>`,
    ),
  ],
] as const

const presetSets = { person: people, organization: organizations }

const side = 256

async function shrink(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = side / Math.min(bitmap.width, bitmap.height)
  const canvas = new OffscreenCanvas(side, side)
  const context = canvas.getContext("2d")
  context?.drawImage(
    bitmap,
    (side - bitmap.width * scale) / 2,
    (side - bitmap.height * scale) / 2,
    bitmap.width * scale,
    bitmap.height * scale,
  )
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
  return new Promise<string>((done, fail) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => done(typeof reader.result === "string" ? reader.result : ""))
    reader.addEventListener("error", () => fail(new Error("Couldn’t read the image")))
    reader.readAsDataURL(blob)
  })
}

export function AvatarPicker(props: {
  kind: keyof typeof presetSets
  label: string
  name: string
  value: string | null | undefined
  disabled?: boolean | undefined
  onChange: (value: string | null) => Promise<unknown>
  trigger?: ReactElement | undefined
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const shape = props.kind === "organization" ? "rounded-lg" : "rounded-full"
  const save = (value: string | null) => {
    setSaving(true)
    void props
      .onChange(value)
      .then(() => setOpen(false))
      .finally(() => setSaving(false))
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={props.disabled}
        render={
          props.trigger ?? (
            <Button
              variant="ghost"
              className={cn("size-9 p-0 transition-transform duration-150 ease-out active:scale-95", shape)}
              aria-label={`Change ${props.label}`}
            />
          )
        }
      >
        <Avatar className={cn("size-9 after:rounded-[inherit]", shape)}>
          {props.value ? <AvatarImage src={props.value} alt="" className={shape} /> : null}
          <AvatarFallback className={shape}>{props.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-3 p-3">
        <PopoverTitle className="text-sm font-medium">{props.label}</PopoverTitle>
        <div className="grid grid-cols-6 gap-1.5">
          {presetSets[props.kind].map((preset) => {
            const url = svg(preset[1])
            return (
              <Button
                key={preset[0]}
                variant="ghost"
                aria-label={`Use ${preset[0]}`}
                aria-pressed={props.value === url}
                disabled={saving}
                className={cn("size-10 p-0 aria-pressed:ring-2 aria-pressed:ring-ring", shape)}
                onClick={() => save(url)}
              >
                <img src={url} alt="" className={cn("size-9", shape)} />
              </Button>
            )
          })}
        </div>
        <Separator />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => file.current?.click()}>
            {saving ? <Spinner data-icon="inline-start" /> : <IconPhotoUp data-icon="inline-start" />}
            Upload a photo
          </Button>
          {props.value ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              disabled={saving}
              onClick={() => save(null)}
            >
              <IconTrash data-icon="inline-start" />
              Remove
            </Button>
          ) : null}
        </div>
        <Input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const picked = event.currentTarget.files?.item(0)
            event.currentTarget.value = ""
            if (!picked) return
            void shrink(picked).then(save, (error: unknown) =>
              toast.error("Couldn’t use that image", {
                description: error instanceof Error ? error.message : undefined,
              }),
            )
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
