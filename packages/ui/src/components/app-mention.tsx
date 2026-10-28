export * as AppMention from "./app-mention.js"

import { cn } from "cn"

export type App = {
  slug: string
  name: string
  icon: string | null
  color?: string | null | undefined
}

export function Logo(props: { name: string; icon: string | null; className?: string | undefined }) {
  if (props.icon)
    return (
      <img
        src={props.icon}
        alt=""
        draggable={false}
        className={cn("inline-block size-[1.25em] rounded-sm object-cover", props.className)}
      />
    )
  return (
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

export function Chip(props: { app: App }) {
  return (
    <span
      data-slot="app-mention"
      className="font-medium whitespace-nowrap text-ring"
      style={props.app.color ? { color: props.app.color } : undefined}
    >
      <Logo name={props.app.name} icon={props.app.icon} className="mr-[0.3em] align-[-0.28em]" />
      {props.app.name}
    </span>
  )
}

const mention = /(^|\s)@([a-z0-9][a-z0-9-]*)/giu

export const link = "#ren-app:"

export function withMentions(text: string, apps: ReadonlyArray<App>) {
  if (!text.includes("@") || apps.length === 0) return [text]
  const bySlug = new Map(apps.map((app) => [app.slug.toLowerCase(), app]))
  const found = [...text.matchAll(mention)].flatMap((match) => {
    const app = bySlug.get((match[2] ?? "").toLowerCase())
    const start = match.index + (match[1] ?? "").length
    return app ? [{ start, end: start + 1 + (match[2] ?? "").length, app }] : []
  })
  return [
    ...found.flatMap((item, index) => [
      text.slice(found[index - 1]?.end ?? 0, item.start),
      <Chip key={item.start} app={item.app} />,
    ]),
    text.slice(found.at(-1)?.end ?? 0),
  ]
}

export function links(markdown: string, apps: ReadonlyArray<App>) {
  if (!markdown.includes("@") || apps.length === 0) return markdown
  const slugs = new Set(apps.map((app) => app.slug.toLowerCase()))
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/u)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replaceAll(mention, (whole, space: string, slug: string) =>
            slugs.has(slug.toLowerCase()) ? `${space}[@${slug}](${link}${slug.toLowerCase()})` : whole,
          ),
    )
    .join("")
}
