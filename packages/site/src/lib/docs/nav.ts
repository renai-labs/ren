import type { Item, Node, Root } from "fumadocs-core/page-tree"
import { type DocsPage, pageHref, source } from "./source.js"

type NavItem = string | { slug: string; label: string }
type Section = {
  title: string
  description: string
  icon: "BookOpen" | "Code"
  home: string
  groups: { title: string; items: NavItem[] }[]
}

const DOCS: Section = {
  title: "Documentation",
  description: "Guides and integrations",
  icon: "BookOpen",
  home: "",
  groups: [
    {
      title: "Get started",
      items: ["", "quickstart", { slug: "concepts/overview", label: "How Ren is organized" }, "surfaces/web-app"],
    },
    {
      title: "Work with Ren",
      items: ["concepts/chats", "concepts/tasks", "concepts/schedules", "concepts/artifacts", "concepts/blueprints"],
    },
    {
      title: "Organize",
      items: [
        "concepts/organizations",
        "concepts/spaces",
        "concepts/projects",
        "concepts/environments",
        "concepts/storage",
      ],
    },
    {
      title: "Tools and access",
      items: ["concepts/apps", "concepts/skills", "concepts/custom-mcps", "concepts/credentials"],
    },
    {
      title: "Channels",
      items: [
        { slug: "concepts/channels", label: "Overview" },
        "concepts/channels/slack",
        "concepts/channels/linear",
        "concepts/channels/github",
        "concepts/channels/email",
        "concepts/channels/telegram",
        "concepts/channels/whatsapp",
      ],
    },
    {
      title: "Move to Ren",
      items: [
        { slug: "migrate/claude", label: "Claude" },
        { slug: "migrate/gpt", label: "GPT" },
        "migrate/cursor",
        "migrate/devin",
      ],
    },
    { title: "Resources", items: ["faq"] },
  ],
}

const DEVELOPERS: Section = {
  title: "Developers",
  description: "CLI, MCP, and SDK",
  icon: "Code",
  home: "surfaces/cli",
  groups: [
    {
      title: "Use Ren from your tools",
      items: ["surfaces/cli", "surfaces/mcp", "surfaces/sdk"],
    },
    {
      title: "Reference",
      items: ["developers/inference-setup", "developers/llms-txt"],
    },
  ],
}

const SECTIONS = [DOCS, DEVELOPERS]

const slugOf = (item: NavItem) => (typeof item === "string" ? item : item.slug)

function pageAt(slug: string): DocsPage {
  const page = source.getPage(slug ? slug.split("/") : [])
  if (!page) throw new Error(`docs nav: "${slug}" has no page`)
  return page
}

const sectionBySlug = new Map(
  SECTIONS.flatMap((section) =>
    section.groups.flatMap((group) => group.items.map((item) => [slugOf(item), section] as const)),
  ),
)

const unlisted = source
  .getPages()
  .map((page) => page.slugs.join("/"))
  .filter((slug) => !sectionBySlug.has(slug))
if (unlisted.length > 0 && !import.meta.env.DEV) {
  throw new Error(`docs nav: add these pages to src/lib/docs/nav.ts: ${unlisted.join(", ")}`)
}

export const sectionOf = (page: DocsPage) => sectionBySlug.get(page.slugs.join("/")) ?? DOCS

export const navTree = (section: Section): Root => ({
  name: section.title,
  children: section.groups.flatMap((group): Node[] => [
    { type: "separator", name: group.title },
    ...group.items.map((item): Item => {
      const page = pageAt(slugOf(item))
      return {
        type: "page",
        name: typeof item === "string" ? page.data.title : item.label,
        url: pageHref(page),
        icon: page.data.icon,
      }
    }),
  ]),
})

export type SectionLink = {
  title: string
  description: string
  href: string
  icon: Section["icon"]
  current: boolean
}

export const sectionLinks = (current: Section): SectionLink[] =>
  SECTIONS.map((section) => ({
    title: section.title,
    description: section.description,
    icon: section.icon,
    href: pageHref(pageAt(section.home)),
    current: section === current,
  }))

export const navGroups = () =>
  SECTIONS.flatMap((section) =>
    section.groups.map((group) => ({
      title: section === DOCS ? group.title : `${section.title}: ${group.title}`,
      pages: group.items.map((item) => pageAt(slugOf(item))),
    })),
  )
