import path from "path"

const root = path.resolve(import.meta.dir, "..")
const names = Bun.argv.slice(2)
if (names.length === 0) throw new Error("Usage: bun run notes <component>...")

const theme = await Bun.file(path.join(root, "src/styles/theme.css")).text()
const tokenOf = new Map(
  [...theme.matchAll(/--color-([a-z-]+): var\(--ren-color-([a-z-]+)\)/gu)].map((match) => [match[1], match[2]]),
)
const shadcnColors = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
].toSorted((a, b) => b.length - a.length)
const colorClass = new RegExp(
  `(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|caret|decoration|shadow)-(${shadcnColors.join("|")})(?![\\w-])`,
  "gu",
)
const radiusClass = /rounded(?:-[trblse]{1,2})?-(sm|md|lg|xl|2xl)\b/gu
const iconName = /\b(Icon[A-Z]\w+)\b/gu
const radii: Readonly<Record<string, string>> = { sm: "4px", md: "8px", lg: "8px", xl: "12px", "2xl": "16px" }

await Promise.all(
  names.map(async (name) => {
    const note = Bun.file(path.join(root, "src/components", `${name}.md`))
    if (await note.exists()) return
    const source = await Bun.file(path.join(root, "src/components", `${name}.tsx`)).text()
    const colors = [...new Set([...source.matchAll(colorClass)].map((match) => match[1] ?? ""))]
    const corners = [...new Set([...source.matchAll(radiusClass)].map((match) => match[1] ?? ""))]
    const icons = [...new Set([...source.matchAll(iconName)].map((match) => match[1] ?? ""))]
    const title = name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
    const lines = [
      `# ${title}`,
      "",
      `Generated with \`shadcn add ${name}\` (style \`base-nova\`, Base UI).`,
      "",
      "## Changes to the component",
      "",
      `None. The code in \`${name}.tsx\` is what the shadcn CLI generated. Its props, parts and names are shadcn's.`,
      "",
      "## What looks different, and why",
      "",
      "Only the theme changed (see `src/styles/theme.css`). This component reads these theme values:",
      "",
      ...(colors.length === 0
        ? ["No colour variables."]
        : [
            "| shadcn variable | Ren token |",
            "| --- | --- |",
            ...colors.map((color) => `| \`${color}\` | \`${tokenOf.get(color) ?? "none"}\` |`),
          ]),
      "",
      ...(corners.length === 0
        ? []
        : [
            `Corners use Ren's radius scale: ${corners.map((corner) => `\`rounded-${corner}\` is ${radii[corner] ?? "?"}`).join(", ")}.`,
            "",
          ]),
      ...(icons.length === 0
        ? []
        : [
            `Icons are Tabler, because \`components.json\` sets \`iconLibrary\` to \`tabler\`: ${icons.join(", ")}.`,
            "",
          ]),
      "Fonts come from the theme: SF Pro for text, IBM Plex Mono for code.",
      "",
    ]
    await Bun.write(note, lines.join("\n"))
    console.log(`created src/components/${name}.md`)
  }),
)
