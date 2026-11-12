export * as AppCategories from "./app-categories.js"

import { categoryLabel } from "../../lib/apps.js"

export interface Category {
  readonly slug: string
  readonly title: string
  readonly description?: string
  readonly apps: ReadonlyArray<string>
}

export const featuredLimit = 6

export const list: ReadonlyArray<Category> = [
  {
    slug: "popular",
    title: "Popular",
    description: "The apps teams add first.",
    apps: ["github", "linear", "notion", "gmail", "google-drive", "figma"],
  },
  {
    slug: "engineering",
    title: "Engineering",
    description: "Ship, monitor and debug software.",
    apps: ["sentry", "vercel", "supabase", "datadog", "cloudflare", "postman"],
  },
  {
    slug: "project-management",
    title: "Project management",
    description: "Plan work and track issues.",
    apps: ["linear", "atlassian", "clickup", "monday", "todoist"],
  },
  {
    slug: "docs",
    title: "Docs and knowledge",
    description: "Write, find and share what your team knows.",
    apps: ["notion", "google-docs", "google-sheets", "guru", "craft", "egnyte"],
  },
  {
    slug: "meetings",
    title: "Meetings",
    description: "Notes, transcripts and follow-ups from every call.",
    apps: ["granola", "fathom", "fireflies", "otter-ai", "circleback", "google-calendar"],
  },
  {
    slug: "crm",
    title: "Sales and CRM",
    description: "Find leads, work deals and keep your CRM current.",
    apps: ["attio", "apollo", "close", "outreach", "common-room", "day-ai"],
  },
  {
    slug: "analytics",
    title: "Analytics",
    description: "Ask questions of your product and business data.",
    apps: ["posthog", "mixpanel", "amplitude", "google-analytics", "airtable", "motherduck"],
  },
  {
    slug: "marketing",
    title: "Marketing",
    description: "Run campaigns, SEO and content.",
    apps: ["google-ads", "meta-ads", "ahrefs", "klaviyo", "webflow", "substack"],
  },
  {
    slug: "design",
    title: "Design",
    description: "Create designs, diagrams and media.",
    apps: ["figma", "canva", "miro", "lucid", "tldraw", "image-generation"],
  },
  {
    slug: "finance",
    title: "Finance",
    description: "Spend, books and cash, in one conversation.",
    apps: ["brex", "ramp", "mercury", "digits", "rillet", "stripe"],
  },
]

export const find = (slug: string): Category =>
  list.find((category) => category.slug === slug) ?? { slug, title: categoryLabel(slug), apps: [] }

export const featured = [...new Set(list.flatMap((category) => category.apps.slice(0, featuredLimit)))]
