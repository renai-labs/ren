import { cn } from "cn"

export type MentionApp = {
  readonly slug: string
  readonly name: string
  readonly icon: string | null
  readonly brandColor: string | null
}

const mention = /(^|\s)@([a-z0-9][a-z0-9-]*)/giu

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
    <span
      data-app-mention={props.app.slug}
      className="whitespace-nowrap"
      style={{ color: props.app.brandColor ?? "var(--ring)" }}
    >
      <MentionLogo name={props.app.name} icon={props.app.icon} className="mr-[0.3em] align-[-0.28em]" />
      {props.app.name}
    </span>
  )
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
