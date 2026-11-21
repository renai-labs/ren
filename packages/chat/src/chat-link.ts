export * as ChatLink from "./chat-link.js"

export interface Target {
  readonly id: string
  readonly child?: string | undefined
}

const id = "ses_[0-9A-HJKMNP-TV-Z]{26}"
const exact = new RegExp(`^${id}$`, "u")
const bare = new RegExp(`(?<![A-Za-z0-9_])(${id})(?![A-Za-z0-9_])`, "u")

const isId = (value: string) => exact.test(value)

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

export interface Node {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[] | undefined
  value?: string
}

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
    const pieces = child.type === "text" ? (child.value ?? "").split(bare) : []
    if (pieces.length < 2) {
      link(child)
      return [child]
    }
    return pieces.flatMap((value, index) => {
      if (value === "") return []
      const text = { type: "text", value }
      return [
        index % 2 === 1
          ? { type: "element", tagName: "a", properties: { href: `${hash}${value}` }, children: [text] }
          : text,
      ]
    })
  })
}
