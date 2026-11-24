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
    { title: "Get started", items: ["", "quickstart", "models"] },
    {
      title: "Work",
      items: [
        { slug: "chats", label: "Chat" },
        "tasks",
        { slug: "automations", label: "Automations" },
        { slug: "drive", label: "Drive" },
        "artifacts",
      ],
    },
    { title: "Integrations", items: ["apps", "credentials", "channels"] },
    { title: "Behavior", items: ["instructions", "memory", "permissions"] },
    { title: "Admin", items: [{ slug: "machines", label: "Machines" }, "usage", "members"] },
    {
      title: "Space",
      items: [{ slug: "spaces", label: "Overview" }, "inbox", "agents", "factory", "repositories", "compute"],
    },
    {
      title: "Organisation",
      items: [{ slug: "organisation", label: "Overview" }, "model-providers", "billing"],
    },
    {
      title: "Clients",
      items: ["ren-mcp", "mobile"],
    },
  ],
}

const DEVELOPERS: Section = {
  title: "Developers",
  description: "CLI and MCP",
  icon: "Code",
  home: "developers/cli",
  groups: [
    { title: "Get started", items: ["developers/cli", "developers/mcp"] },
    { title: "Guides", items: ["developers/ren-as-code", "developers/inference-setup", "developers/scripting"] },
    {
      title: "Reference",
      items: ["developers/cli-commands", "developers/mcp-tools", "developers/ren-folder", "developers/llms-txt"],
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
