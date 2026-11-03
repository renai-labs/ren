const source = await Bun.file(new URL("../../ui/src/styles/index.css", import.meta.url)).text()
const target = new URL("../src/theme.gen.css", import.meta.url)

const block = (selector: string) => {
  const found = new RegExp(`^${selector} \\{([\\s\\S]*?)^\\}`, "m").exec(source)?.[1]
  if (found === undefined) throw new Error(`packages/ui/src/styles/index.css has no "${selector}" block`)
  return new Map(
    found
      .split(";")
      .map((declaration) => /^(--[\w-]+):\s*([\s\S]+)$/.exec(declaration.trim()))
      .filter((match) => match !== null)
      .map((match) => [match[1] ?? "", (match[2] ?? "").replaceAll(/\s+/g, " ")] as const),
  )
}

const theme = block("@theme inline")
const colors = [...theme].flatMap((entry) => {
  const variable = /^var\((--[\w-]+)\)$/.exec(entry[1])?.[1]
  return entry[0].startsWith("--color-") && variable ? [[entry[0], variable] as const] : []
})
const scales = [...theme].filter((entry) => !entry[0].startsWith("--font-") && !entry[1].includes("var("))

const light = block(":root")

const variant = (name: string, values: Map<string, string>) => [
  `    @variant ${name} {`,
  ...colors.map((color) => {
    const value = values.get(color[1])
    if (value === undefined) throw new Error(`The ${name} theme has no ${color[1]}`)
    return `      ${color[0]}: ${value};`
  }),
  "    }",
]

await Bun.write(
  target,
  [
    "@theme {",
    ...scales.map((entry) => `  ${entry[0]}: ${entry[1]};`),
    ...colors.map((color) => `  ${color[0]}: ${light.get(color[1])};`),
    "}",
    "",
    "@layer theme {",
    "  :root {",
    ...variant("light", light),
    ...variant("dark", new Map([...light, ...block("\\.dark")])),
    "  }",
    "}",
    "",
  ].join("\n"),
)
