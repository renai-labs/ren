export * as ResourceIcon from "./resource-icon.js"

import { Schema } from "effect"

export const colors = ["neutral", "azure", "violet", "green", "amber", "coral"] as const
export type Color = (typeof colors)[number]

export type Value =
  | { readonly type: "tabler"; readonly name: string; readonly color: Color }
  | { readonly type: "emoji"; readonly emoji: string }
  | { readonly type: "image"; readonly url: string }

export const maximumLength = 2048

export const uploadFormats = ["png", "jpeg", "webp"] as const

export const uploadTypes: ReadonlyArray<string> = uploadFormats.map((format) => `image/${format}`)

export const maximumUploadBytes = 512 * 1024

export const uploadTooLarge = "Image must be 512 KB or smaller."

export const uploadUnreadable = "Choose a PNG, JPEG or WebP image."

const tabler = /^tabler:(Icon[A-Z][A-Za-z0-9]*):([a-z]+)$/u

const inlinePreset = /^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/u

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])

const isImageUrl = (value: string) => {
  const url = URL.parse(value)
  return url?.protocol === "https:" || (url?.protocol === "http:" && loopback.has(url.hostname))
}

const isColor = (value: string): value is Color => colors.some((color) => color === value)

export const tablerOf = (name: string, color: Color) => `tabler:${name}:${color}`

export const emojiOf = (emoji: string) => `:${emoji}`

const read = (value: string | null | undefined, inlinePresets: boolean): Value | undefined => {
  if (!value) return undefined
  const glyph = tabler.exec(value)
  if (glyph) {
    const name = glyph.at(1)
    const color = glyph.at(2)
    return name && color && isColor(color) ? { type: "tabler", name, color } : undefined
  }
  if (value.startsWith(":") && /\P{ASCII}/u.test(value)) return { type: "emoji", emoji: value.slice(1) }
  if (isImageUrl(value) || (inlinePresets && inlinePreset.test(value))) return { type: "image", url: value }
  return undefined
}

export const parse = (value: string | null | undefined) => read(value, true)

export const Descriptor = Schema.String.check(
  Schema.isMaxLength(maximumLength, { message: `Use ${maximumLength} characters or fewer.` }),
  Schema.makeFilter(
    (value) =>
      read(value, false) !== undefined ||
      "Use a Tabler icon (tabler:<Name>:<color>), an emoji (:<emoji>) or an uploaded image URL.",
  ),
).annotate({
  identifier: "ResourceIcon.Descriptor",
  description: "A picture: `tabler:<Name>:<color>`, `:<emoji>`, or the https URL of an uploaded image.",
})

export const Stored = Schema.NullOr(Schema.String).annotate({
  description:
    "A `ResourceIcon.Descriptor`, or a preset image older profiles keep inline as a data URL. Null: the default icon.",
})

export interface Upload extends Schema.Schema.Type<typeof Upload> {}
export const Upload = Schema.Struct({
  url: Schema.String.annotate({
    description: "Save it as the icon of a profile, an organization, a space or an agent.",
  }),
}).annotate({ identifier: "ResourceIcon.Upload" })
