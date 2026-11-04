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
import { Avatars } from "../icons/avatars.js"

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
  kind: keyof typeof Avatars.presets
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
          {Avatars.presets[props.kind].map((preset) => (
            <Button
              key={preset.name}
              variant="ghost"
              aria-label={`Use ${preset.name}`}
              aria-pressed={props.value === preset.url}
              disabled={saving}
              className={cn("size-10 p-0 aria-pressed:ring-2 aria-pressed:ring-ring", shape)}
              onClick={() => save(preset.url)}
            >
              <img src={preset.url} alt="" className={cn("size-9", shape)} />
            </Button>
          ))}
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
