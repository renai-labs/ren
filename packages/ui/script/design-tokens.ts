import path from "path"

export type Mode = "light" | "dark" | "girliepop"

export interface Token {
  readonly type: string
  readonly name: string
  readonly value: string
}

export interface Tokens {
  readonly colors: ReadonlyMap<string, Readonly<Record<Mode, string>>>
  readonly scales: ReadonlyArray<Token>
}

export const modes: ReadonlyArray<Mode> = ["light", "dark", "girliepop"]

const types: Readonly<Record<string, string>> = {
  "font-weight": "fontWeight",
  font: "fontFamily",
  text: "fontSize",
  leading: "lineHeight",
  tracking: "letterSpacing",
  spacing: "spacing",
  radius: "radius",
  opacity: "opacity",
  container: "container",
  breakpoint: "breakpoint",
}
const typePrefix = /^(font-weight|font|text|leading|tracking|spacing|radius|opacity|container|breakpoint)-/
const fontStacks: Readonly<Record<string, string>> = {
  "font-sans": '"SF Pro Variable", sans-serif',
  "font-mono": '"IBM Plex Mono", monospace',
}
const remTypes = new Set(["fontSize", "lineHeight", "spacing", "container", "breakpoint"])

export const root = path.resolve(import.meta.dir, "..")
export const designFile = path.join(root, "DESIGN.md")
export const generatedFile = path.join(root, "src/styles/tokens.generated.css")

export function parse(markdown: string): Tokens {
  const rows = markdown
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
  const colors = new Map(
    rows.flatMap((cells) =>
      cells.length === 4 && /^(#|rgba\()/.test(cells[1] ?? "")
        ? [[cells[0] ?? "", { light: cells[1] ?? "", dark: cells[2] ?? "", girliepop: cells[3] ?? "" }] as const]
        : [],
    ),
  )
  const scales = rows
    .filter((cells) => cells.length === 2 && cells[0] !== "Token" && !/^-+$/.test(cells[0] ?? ""))
    .map((cells) => {
      const name = cells[0] ?? ""
      const type = types[typePrefix.exec(name)?.[1] ?? ""]
      if (type === undefined) throw new Error(`DESIGN.md: unknown token "${name}"`)
      return { type, name, value: cells[1] ?? "" }
    })
  if (colors.size === 0) throw new Error("DESIGN.md: no color tokens found")
  if (new Set(scales.map((token) => token.name)).size !== scales.length) throw new Error("DESIGN.md: duplicate token")
  return { colors, scales }
}

export function runtimeValue(token: Token) {
  const stack = fontStacks[token.name]
  if (stack !== undefined) return stack
  if (remTypes.has(token.type) && token.value.endsWith("px")) return `${parseFloat(token.value) / 16}rem`
  return token.value
}

export function render(tokens: Tokens) {
  const colors = (mode: Mode) =>
    Array.from(tokens.colors, (entry) => `  --ren-color-${entry[0]}: ${entry[1][mode]};`).join("\n")
  const scales = tokens.scales.map((token) => `  --ren-${token.name}: ${runtimeValue(token)};`).join("\n")
  return `:root,\n.light {\n${colors("light")}\n${scales}\n}\n\n.dark,\n:root[data-theme="dark"] {\n${colors("dark")}\n}\n\n.girliepop,\n:root[data-theme="girliepop"] {\n${colors("girliepop")}\n}\n`
}

if (import.meta.main) {
  const tokens = parse(await Bun.file(designFile).text())
  await Bun.write(generatedFile, render(tokens))
  console.log(`DESIGN.md -> tokens.generated.css (${tokens.colors.size} colors, ${tokens.scales.length} scale tokens)`)
}
