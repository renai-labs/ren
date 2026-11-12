import type { ReactNode } from "react"
import { cn } from "cn"

export type MentionApp = {
  readonly slug: string
  readonly name: string
  readonly icon: string | null
  readonly brandColor: string | null
}

const mention = /(^|\s)@([a-z0-9][a-z0-9-]*)/giu

export const chipClosing = /^[.,;:!?)\]}"'’”…]+/u
export const chipOpening = /[([{"'‘“]+$/u

export function ChipText(props: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{props.children}</span>
}

export function MentionLogo(props: { name: string; icon: string | null; className?: string | undefined }) {
  return props.icon ? (
    <img
      src={props.icon}
      alt=""
      draggable={false}
      className={cn("inline-block size-[1.25em] rounded-sm bg-white object-contain p-[0.12em]", props.className)}
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

export function AppMention(props: { app: MentionApp }) {
  return (
    <span className="whitespace-nowrap" style={{ color: props.app.brandColor ?? "var(--ring)" }}>
      <MentionLogo name={props.app.name} icon={props.app.icon} className="mr-[0.3em] align-[-0.28em]" />
      {props.app.name}
    </span>
  )
}

export function withAppMentions(text: string, apps: ReadonlyArray<MentionApp>): ReactNode {
  if (!text.includes("@") || apps.length === 0) return text
  const bySlug = new Map(apps.map((app) => [app.slug.toLowerCase(), app]))
  const nodes: ReactNode[] = []
  const state = { from: 0 }
  for (const match of text.matchAll(mention)) {
    const slug = match[2] ?? ""
    const app = bySlug.get(slug.toLowerCase())
    if (!app) continue
    const start = match.index + (match[1] ?? "").length
    const end = start + 1 + slug.length
    const opening = chipOpening.exec(text.slice(state.from, start))?.[0] ?? ""
    const closing = chipClosing.exec(text.slice(end))?.[0] ?? ""
    nodes.push(
      text.slice(state.from, start - opening.length),
      <ChipText key={start}>
        {opening}
        <AppMention app={app} />
        {closing}
      </ChipText>,
    )
    state.from = end + closing.length
  }
  if (nodes.length === 0) return text
  nodes.push(text.slice(state.from))
  return nodes
}

export const mentionLinks = (markdown: string, apps: ReadonlyArray<MentionApp>) => {
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
