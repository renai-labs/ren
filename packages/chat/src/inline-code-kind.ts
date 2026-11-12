export * as InlineCodeKind from "./inline-code-kind.js"

const fileNames = new Set([
  "CHANGELOG",
  "CODEOWNERS",
  "Containerfile",
  "Dockerfile",
  "Gemfile",
  "Justfile",
  "LICENSE",
  "Makefile",
  "Procfile",
  "README",
  "Rakefile",
  "Vagrantfile",
])

const maxLine = 1_000_000
const hashSuffix = /^(.*?)#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i
const colonSuffix = /^(.*?):(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?:?$/
const workspace = /^\/(?:.*\/)?workspace\/[^/]+\/(.+)$/u

const lineRange = (first: number, second: number) =>
  [first, second].every((line) => Number.isSafeInteger(line) && line >= 1 && line <= maxLine)
    ? { start: Math.min(first, second), end: Math.max(first, second) }
    : undefined

export function parsePathLineSuffix(input: string) {
  const hash = hashSuffix.exec(input)
  if (hash)
    return { path: hash.at(1) ?? "", selection: lineRange(Number(hash.at(2)), Number(hash.at(3) ?? hash.at(2))) }
  const colon = colonSuffix.exec(input)
  if (colon && !/^[a-z]:?$/i.test(colon.at(1) ?? ""))
    return { path: colon.at(1) ?? "", selection: lineRange(Number(colon.at(2)), Number(colon.at(3) ?? colon.at(2))) }
  return { path: input, selection: undefined }
}

export function inlineCodeKind(text: string): "path" | "url" | undefined {
  if (/^https?:\/\//i.test(text)) return "url"
  if (!text || /\s/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return undefined
  if (/[{}<>"'`;=|&*,]/.test(text)) return undefined
  if (/^[\\/]{2}/.test(text)) return undefined
  const path = parsePathLineSuffix(text).path
  return fileNames.has(path) || (/[./\\]/.test(path) && /[a-z]/i.test(path)) ? "path" : undefined
}

export function workspacePath(text: string): string | undefined {
  const path = parsePathLineSuffix(text).path
  const relative = (path.startsWith("/") ? workspace.exec(path)?.at(1) : path)?.replace(/^(?:\.\/)+/u, "")
  const valid =
    inlineCodeKind(text) === "path" &&
    relative &&
    !relative.endsWith("/") &&
    !relative.includes("\\") &&
    !relative.split("/").includes("..")
  return valid ? relative : undefined
}
