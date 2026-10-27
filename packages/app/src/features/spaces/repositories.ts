export * as Repositories from "./repositories.js"

import { isInvalidRequestError } from "@ren/client"
import type { Reference } from "@ren/schema/reference"

// oxlint-disable-next-line ren/no-comments -- R28: a reference is a read-only copy, so the copy never promises changes.
export const copy = "Ren reads a copy of these repositories."

export const tabCopy = "Ren reads a copy of these repositories. To change code, ask Ren to clone the repository."

export interface Parsed {
  readonly repository: string
  readonly name: string
  readonly branch?: string
}

const scheme = /^[a-z][a-z0-9+.-]*:\/\//iu

const sshUser = /^[^/@]+@/u

const sshPath = /^([^/:]+):(?!\d+(?:\/|$))/u

// oxlint-disable-next-line ren/no-comments -- R61: the segments where a browse link leaves the repository path: GitLab's "-" and GitHub's views. A host such as GitLab nests groups, so every segment before them stays.
const views = new Set([
  "-",
  "tree",
  "blob",
  "pulls",
  "pull",
  "issues",
  "commit",
  "commits",
  "compare",
  "actions",
  "releases",
  "tags",
  "wiki",
])

// oxlint-disable-next-line ren/no-comments -- §5a step 3, ren-v1 parseGitRepository: a browse link becomes https://<host>/<path…>; only /tree/<ref> (GitLab /-/tree/<ref>) keeps its branch.
export const parse = (input: string): Parsed | undefined => {
  const trimmed = input.trim().split(/[?#]/u).at(0) ?? ""
  const parts = trimmed.replace(scheme, "").replace(sshUser, "").replace(sshPath, "$1/").split("/")
  const host = (parts.at(0) ?? "").replace(/:\d+$/u, "").toLowerCase()
  const rest = parts.slice(1).filter(Boolean)
  const end = rest.findIndex((segment, index) => index >= 2 && views.has(segment))
  const path = end === -1 ? rest : rest.slice(0, end)
  const name = path.at(-1)?.replace(/\.git$/iu, "")
  if (!host.includes(".") || path.length < 2 || !name) return undefined
  const view = end === -1 ? [] : rest.slice(end)
  const browse = view.at(0) === "-" ? view.slice(1) : view
  const branch = browse.at(0) === "tree" ? browse.at(1) : undefined
  return { repository: `https://${host}/${[...path.slice(0, -1), name].join("/")}`, name, ...(branch && { branch }) }
}

// oxlint-disable-next-line ren/no-comments -- §5a step 4: the repository name in lower case, and -2, -3 for a taken one. An alias has no slash, backslash, space, backtick or comma (Reference.Alias).
export const aliasFor = (name: string, taken: Iterable<string>) => {
  const used = new Set(taken)
  const base =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/gu, "-")
      .replaceAll(/^-+|-+$/gu, "") || "repository"
  if (!used.has(base)) return base
  const free = Array.from({ length: used.size + 1 }, (_, index) => `${base}-${index + 2}`).find(
    (alias) => !used.has(alias),
  )
  return free ?? `${base}-${used.size + 2}`
}

export interface Draft {
  readonly repository: string
  readonly alias: string
  readonly branch: string
  readonly description: string
}

export const draftOf = (
  found: {
    readonly repository: string
    readonly name: string
    readonly branch?: string
    readonly description?: string
  },
  taken: Iterable<string>,
): Draft => ({
  repository: found.repository,
  alias: aliasFor(found.name, taken),
  branch: found.branch ?? "",
  description: found.description ?? "",
})

export const infoOf = (draft: Draft): Reference.Info => ({
  alias: draft.alias.trim(),
  repository: draft.repository,
  ...(draft.branch.trim() && { branch: draft.branch.trim() }),
  description: draft.description.trim(),
})

export const page = <A>(all: ReadonlyArray<A>, wanted: number, size: number) => {
  const pageCount = Math.max(1, Math.ceil(all.length / size))
  const current = Math.min(Math.max(1, wanted), pageCount)
  return { items: all.slice((current - 1) * size, current * size), page: current, pageCount, total: all.length }
}

export const nameOf = (repository: string) => repository.replace(/^https:\/\//u, "")

// oxlint-disable-next-line ren/no-comments -- A save that Ren refuses names the reference in field references.<alias> (R13, R26), so the dialog shows the message on that row.
export const refusal = (error: unknown): { readonly alias?: string; readonly message: string } => {
  if (isInvalidRequestError(error) && error.field?.startsWith("references."))
    return { alias: error.field.slice("references.".length), message: error.message }
  return { message: error instanceof Error || isInvalidRequestError(error) ? error.message : String(error) }
}
