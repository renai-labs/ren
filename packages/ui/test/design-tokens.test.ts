import { describe, expect, test } from "bun:test"
import path from "path"
import { designFile, generatedFile, modes, parse, render, root, runtimeValue } from "../script/design-tokens.ts"

const tokens = parse(await Bun.file(designFile).text())
const generated = await Bun.file(generatedFile).text()
const theme = (await Bun.file(path.join(root, "src/styles/theme.css")).text()).replace(/\/\*[\s\S]*?\*\//g, "")
const defined = new Set(Array.from(generated.matchAll(/(--ren-[\w-]+)\s*:/g), (match) => match[1]))

const luminance = (hex: string) => {
  const channels = Array.from(hex.slice(1).match(/../g) ?? [], (pair) => parseInt(pair, 16) / 255).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
}
const contrast = (ink: string, ground: string) => {
  const pair = [luminance(ink), luminance(ground)]
  return (Math.max(...pair) + 0.05) / (Math.min(...pair) + 0.05)
}
const color = (role: string, mode: (typeof modes)[number]) => tokens.colors.get(role)?.[mode] ?? ""
const ofType = (type: string) => tokens.scales.filter((token) => token.type === type)

describe("design tokens", () => {
  test("tokens.generated.css is generated from DESIGN.md", () => {
    expect(generated).toBe(render(tokens))
  })

  test.each(modes.map((mode) => [mode] as const))("%s text meets WCAG AA on every background", (mode) => {
    const inks = [
      "text-primary",
      "text-secondary",
      "accent-primary",
      "status-success",
      "status-warning",
      "status-danger",
    ]
    const grounds = ["bg-primary", "bg-secondary", "bg-tertiary"]
    const pairs = [
      ...inks.flatMap((ink) => grounds.map((ground) => [ink, ground] as const)),
      ...["text-primary", "accent-primary", "status-success", "status-warning", "status-danger"].map(
        (fill) => ["text-inverse", fill] as const,
      ),
    ]
    const failing = pairs
      .map((pair) => ({ pair: pair.join(" on "), ratio: contrast(color(pair[0], mode), color(pair[1], mode)) }))
      .filter((entry) => entry.ratio < 4.5)
    expect(failing).toEqual([])
  })

  test("scales keep their fixed size", () => {
    expect(tokens.colors.size).toBe(15)
    expect(
      Object.fromEntries(
        ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "radius", "opacity", "container"].map(
          (type) => [type, ofType(type).length],
        ),
      ),
    ).toEqual({
      fontFamily: 2,
      fontSize: 6,
      fontWeight: 4,
      lineHeight: 5,
      letterSpacing: 2,
      radius: 5,
      opacity: 2,
      container: 3,
    })
    expect(ofType("spacing").map((token) => token.name)).toEqual(
      [1, 2, 3, 4, 6, 8, 12].map((step) => `spacing-${step}`),
    )
    expect(ofType("radius").map((token) => token.value)).toEqual(["4px", "8px", "12px", "16px", "9999px"])
    expect(ofType("fontSize").map((token) => token.value)).toEqual(["10px", "12px", "14px", "16px", "20px", "30px"])
  })

  test("the Tailwind theme maps only generated tokens", () => {
    const block = /@theme inline \{([\s\S]*?)\n\}/.exec(theme)?.[1] ?? ""
    const unmapped = Array.from(block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      .filter((match) => match[1] !== "--*")
      .filter((match) => !defined.has(/^var\((--ren-[\w-]+)\)$/.exec(match[2] ?? "")?.[1] ?? ""))
      .map((match) => match[1])
    expect(unmapped).toEqual([])
    const breakpoints = ofType("breakpoint").filter(
      (token) => !theme.includes(`--${token.name}: ${runtimeValue(token)};`),
    )
    expect(breakpoints).toEqual([])
  })
})
