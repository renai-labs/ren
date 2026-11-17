export * as Repositories from "./repositories.js"

import { Mentions } from "./mentions.js"

export interface Info {
  readonly alias: string
  readonly repository: string
  readonly branch?: string
  readonly description: string
}

// oxlint-disable-next-line ren/no-comments -- R28: a reference is a read-only copy, so the copy never promises changes.
export const copy = "Ren reads a copy of these repositories."

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

export const keyOf = (repository: string) => repository.toLowerCase()

export const readable = (parsed: Parsed) => /^https:\/\/github\.com\/[^/]+\/[^/]+$/u.test(parsed.repository)

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

export const infoOf = (draft: Draft): Info => ({
  alias: draft.alias.trim(),
  repository: draft.repository,
  ...(draft.branch.trim() && { branch: draft.branch.trim() }),
  description: draft.description.trim(),
})

export const nameOf = Mentions.repositoryName

export interface Picked {
  readonly parsed: Parsed
  readonly description: string
}

export interface Row {
  readonly key: string
  readonly name: string
  readonly picked: Picked
}

export interface Listing {
  readonly installed: boolean
  readonly repositories: ReadonlyArray<{
    readonly url: string
    readonly name: string
    readonly description?: string | undefined
  }>
}

export const knownOf = (existing: ReadonlyArray<{ readonly repository: string }>) =>
  new Set(existing.map((reference) => keyOf(reference.repository)))

export const candidates = (listings: ReadonlyArray<Listing>, known: ReadonlySet<string>): ReadonlyArray<Row> =>
  listings
    .flatMap((listing) => listing.repositories)
    .flatMap((repository) => {
      const parsed = parse(repository.url)
      return parsed && !known.has(keyOf(parsed.repository))
        ? [
            {
              key: keyOf(parsed.repository),
              name: repository.name,
              picked: { parsed, description: repository.description || repository.name },
            },
          ]
        : []
    })

export const rows = (listed: ReadonlyArray<Row>, picked: ReadonlyMap<string, Picked>): ReadonlyArray<Row> => {
  const listedKeys = new Set(listed.map((row) => row.key))
  return [
    ...[...picked.entries()]
      .filter((entry) => !listedKeys.has(entry[0]))
      .map((entry) => ({ key: entry[0], name: nameOf(entry[1].parsed.repository), picked: entry[1] })),
    ...listed.map((row) => ({ ...row, picked: picked.get(row.key) ?? row.picked })),
  ]
}

export const toggle = (picked: ReadonlyMap<string, Picked>, key: string, each: Picked): ReadonlyMap<string, Picked> => {
  const next = new Map(picked)
  if (!next.delete(key)) next.set(key, each)
  return next
}

export const problemOf = (pasted: Parsed, known: ReadonlySet<string>) => {
  if (known.has(keyOf(pasted.repository))) return `${nameOf(pasted.repository)} is already in this space`
  if (!readable(pasted)) return "Ren reads only repositories on github.com"
  return
}

export const paste = (
  picked: ReadonlyMap<string, Picked>,
  pasted: Parsed,
  listed: ReadonlyArray<Row>,
): ReadonlyMap<string, Picked> => {
  const key = keyOf(pasted.repository)
  const match = listed.find((row) => row.key === key)?.picked
  return new Map(picked).set(key, {
    parsed: match ? { ...match.parsed, ...(pasted.branch && { branch: pasted.branch }) } : pasted,
    description: match?.description ?? nameOf(pasted.repository),
  })
}

export const referencesOf = (
  picked: ReadonlyMap<string, Picked>,
  existing: ReadonlyArray<{ readonly alias: string }>,
) =>
  [...picked.values()].reduce<Info[]>((added, each) => {
    added.push(
      infoOf({
        repository: each.parsed.repository,
        alias: aliasFor(each.parsed.name, [
          ...existing.map((reference) => reference.alias),
          ...added.map((reference) => reference.alias),
        ]),
        branch: each.parsed.branch ?? "",
        description: each.description,
      }),
    )
    return added
  }, [])
