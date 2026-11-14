export * as FileName from "./file-name.js"

const extension = /(\.[^.]*)?$/u

const trailingSlash = /\/$/u

export const base = (path: string) => path.replace(trailingSlash, "").split("/").at(-1) ?? path

export const free = (name: string, taken: ReadonlySet<string>) => {
  const suffix = extension.exec(name)?.at(0) ?? ""
  const stem = name.slice(0, name.length - suffix.length)
  return (
    Array.from({ length: taken.size + 1 }, (_, index) => (index === 0 ? name : `${stem} (${index + 1})${suffix}`)).find(
      (candidate) => !taken.has(candidate),
    ) ?? `${stem} (${taken.size + 2})${suffix}`
  )
}
