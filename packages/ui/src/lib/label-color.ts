import type { BadgeTone } from "../components/badge.js"

const palette = [
  { rgb: 0xd45f5f, tone: "danger" },
  { rgb: 0x6f72d9, tone: "accent" },
  { rgb: 0x2b9ca6, tone: "neutral" },
  { rgb: 0xc88424, tone: "warning" },
  { rgb: 0x2d9b68, tone: "success" },
] as const satisfies ReadonlyArray<{ rgb: number; tone: BadgeTone }>

export const swatches = palette.map((swatch) => ({
  hex: `#${swatch.rgb.toString(16).padStart(6, "0")}`,
  tone: swatch.tone,
}))

export function tone(label: { name: string; color?: string | null }): BadgeTone {
  if (label.color) {
    const color = Number.parseInt(label.color.slice(1), 16)
    return palette.reduce((best, swatch) => {
      const distance = (value: number) =>
        ((value >> 16) - (color >> 16)) ** 2 +
        (((value >> 8) & 255) - ((color >> 8) & 255)) ** 2 +
        ((value & 255) - (color & 255)) ** 2
      return distance(swatch.rgb) < distance(best.rgb) ? swatch : best
    }).tone
  }
  const hash = Array.from(label.name.toLowerCase(), (char) => char.charCodeAt(0)).reduce(
    (value, code) => (value * 31 + code) >>> 0,
    0,
  )
  return palette[hash % palette.length]?.tone ?? "neutral"
}

export function display(name: string): string {
  if (name === "ren-improve") return "improvement"
  if (name === "ren-fix") return "fix"
  return name
}
