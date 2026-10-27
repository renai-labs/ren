import type { ReactNode } from "react"
import { mentionColor, type CatalogApp } from "@/lib/apps"
import { cn } from "@/lib/utils"

const mention = /(^|\s)@([a-z0-9][a-z0-9-]*)/giu

export function MentionLogo(props: { name: string; icon: string | null; className?: string | undefined }) {
  return props.icon ? (
    <img
      src={props.icon}
      alt=""
      draggable={false}
      className={cn("inline-block size-[1.25em] rounded-sm object-cover", props.className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-[1.25em] items-center justify-center rounded-sm bg-secondary text-[0.7em] text-foreground",
        props.className,
      )}
    >
      {props.name.charAt(0)}
    </span>
  )
}

export function AppMention(props: { app: CatalogApp }) {
  return (
    <span className="whitespace-nowrap" style={{ color: mentionColor(props.app) }}>
      <MentionLogo name={props.app.name} icon={props.app.icon} className="mr-[0.3em] align-[-0.28em]" />
      {props.app.name}
    </span>
  )
}

export function withAppMentions(text: string, apps: ReadonlyArray<CatalogApp>): ReactNode {
  if (!text.includes("@") || apps.length === 0) return text
  const bySlug = new Map(apps.map((app) => [app.slug.toLowerCase(), app]))
  const nodes: ReactNode[] = []
  const state = { from: 0 }
  for (const match of text.matchAll(mention)) {
    const app = bySlug.get((match[2] ?? "").toLowerCase())
    if (!app) continue
    const start = match.index + (match[1] ?? "").length
    nodes.push(text.slice(state.from, start), <AppMention key={start} app={app} />)
    state.from = start + 1 + (match[2] ?? "").length
  }
  if (nodes.length === 0) return text
  nodes.push(text.slice(state.from))
  return nodes
}

export const mentionLinks = (markdown: string, apps: ReadonlyArray<CatalogApp>) => {
  if (!markdown.includes("@") || apps.length === 0) return markdown
  const slugs = new Set(apps.map((app) => app.slug.toLowerCase()))
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/u)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replaceAll(mention, (whole, space: string, slug: string) =>
            slugs.has(slug.toLowerCase()) ? `${space}[@${slug}](#ren-app:${slug.toLowerCase()})` : whole,
          ),
    )
    .join("")
}
