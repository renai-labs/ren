export * as FileLabel from "./file-label.js"

export interface Label {
  readonly path: string
  readonly name: string
  readonly line: number | undefined
  readonly folder: boolean
  readonly dir: string | undefined
}

export interface Split {
  readonly stem: string
  readonly extension: string
}

const lineSuffix = /^(?<path>.+?):(?<line>\d+)(?::\d+)?$/

export const parse = (input: string) => {
  const folder = input.endsWith("/")
  const found = folder ? null : lineSuffix.exec(input)
  const path = (found?.groups?.path ?? input).replace(/\/+$/, "")
  const parts = path.split("/")
  return {
    path,
    folder,
    name: parts.at(-1) ?? path,
    parent: parts.at(-2),
    // ast-grep-ignore: no-conditional-property, -- the result type has a required line that may be undefined
    line: found?.groups?.line ? Number(found.groups.line) : undefined,
  }
}

export const labels = (inputs: ReadonlyArray<string>): ReadonlyArray<Label> => {
  const parsed = inputs.map(parse)
  const paths = parsed.reduce(
    (all, item) => all.set(item.name, new Set(all.get(item.name)).add(item.path)),
    new Map<string, ReadonlySet<string>>(),
  )
  return parsed.map((item) => ({
    path: item.path,
    name: item.name,
    folder: item.folder,
    line: item.line,
    // ast-grep-ignore: no-conditional-property, -- the Label type has a required dir that may be undefined
    dir: (paths.get(item.name)?.size ?? 0) > 1 ? item.parent : undefined,
  }))
}

export const text = (label: Label) => (typeof label.line === "number" ? `${label.name}:${label.line}` : label.name)

export const split = (name: string): Split => {
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? { stem: name, extension: "" } : { stem: name.slice(0, dot), extension: name.slice(dot) }
}
