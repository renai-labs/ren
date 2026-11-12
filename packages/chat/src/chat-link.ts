export * as ChatLink from "./chat-link.js"

export interface Target {
  readonly id: string
  readonly child?: string | undefined
}

export interface Match {
  readonly id: string
  readonly start: number
  readonly end: number
}

const id = "ses_[0-9A-HJKMNP-TV-Z]{26}"
const exact = new RegExp(`^${id}$`, "u")
const bare = new RegExp(`(?<![A-Za-z0-9_])${id}(?![A-Za-z0-9_])`, "gu")

export const isId = (value: string) => exact.test(value)

export const hash = "#ren-chat:"

export function parse(href: string, appUrl: string): Target | undefined {
  if (href.startsWith(hash)) return isId(href.slice(hash.length)) ? { id: href.slice(hash.length) } : undefined
  const app = URL.parse(appUrl)
  const url = URL.parse(href)
  if (!app || !url || url.origin !== app.origin) return undefined
  const prefix = `${app.pathname.replace(/\/$/u, "")}/sessions/`
  if (!url.pathname.startsWith(prefix)) return undefined
  const session = url.pathname.slice(prefix.length).replace(/\/$/u, "")
  if (!isId(session)) return undefined
  const child = url.searchParams.get("child")
  return child && isId(child) ? { id: session, child } : { id: session }
}

export const ids = (text: string): ReadonlyArray<Match> =>
  [...text.matchAll(bare)].map((found) => ({
    id: found.at(0) ?? "",
    start: found.index,
    end: found.index + (found.at(0)?.length ?? 0),
  }))

export interface Node {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[] | undefined
  value?: string
}

const anchor = (value: string): Node => ({
  type: "element",
  tagName: "a",
  properties: { href: `${hash}${value}` },
  children: [{ type: "text", value }],
})

export const link = (node: Node): void => {
  if (node.tagName === "pre" || node.tagName === "a") return
  const only = node.children?.length === 1 ? node.children.at(0) : undefined
  if (node.tagName === "code" && only?.type === "text" && isId(only.value ?? "")) {
    node.tagName = "a"
    node.properties = { href: `${hash}${only.value}` }
    return
  }
  if (node.tagName === "code") return
  node.children = node.children?.flatMap((child): Node[] => {
    const found = child.type === "text" ? ids(child.value ?? "") : []
    if (found.length === 0) {
      link(child)
      return [child]
    }
    const text = child.value ?? ""
    return [
      ...found.flatMap((each, index) => [
        { type: "text", value: text.slice(found[index - 1]?.end ?? 0, each.start) },
        anchor(each.id),
      ]),
      { type: "text", value: text.slice(found.at(-1)?.end) },
    ].filter((each) => each.type !== "text" || each.value !== "")
  })
}
