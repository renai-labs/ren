import { relative } from "node:path"
import { type CollectionEntry, getCollection } from "astro:content"
import { loader, type StaticSource } from "fumadocs-core/source"
import { structure } from "fumadocs-core/mdx-plugins"

const MDX_COMMENT_LINE = /^\{\/\*.*\*\/\}\n+/gm
const JSX_SELF_CLOSING = /<[A-Z][\w.]*\b[^>]*?\/>/gs
const JSX_TAG = /<\/?[A-Z][\w.]*\b[^>]*>/g

type DocsEntry = CollectionEntry<"docs">
type DocsFiles = StaticSource<{
  pageData: DocsEntry["data"] & { entry: DocsEntry }
  metaData: Record<string, never>
}>["files"]

const files: DocsFiles = (await getCollection("docs")).map((entry) => ({
  type: "page",
  path: relative("src/content/docs", entry.filePath ?? ""),
  data: { ...entry.data, entry },
}))

export const source = loader({ source: { files }, baseUrl: "/docs" })

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>

export const pageHref = (page: { url: string }) => (page.url.endsWith("/") ? page.url : `${page.url}/`)

const mdxSource = (page: DocsPage) => (page.data.entry.body ?? "").replaceAll(MDX_COMMENT_LINE, "")

export const structuredData = (page: DocsPage) =>
  structure(mdxSource(page).replaceAll(JSX_SELF_CLOSING, "").replaceAll(JSX_TAG, ""))

export const rawMarkdownPath = (page: DocsPage) =>
  page.slugs.length === 0 ? "/raw/docs.md" : `/raw/docs/${page.slugs.join("/")}.md`

export const editUrl = (page: DocsPage) =>
  `https://github.com/renai-labs/ren/edit/main/packages/site/${page.data.entry.filePath}`

export function markdownBody(page: DocsPage) {
  const body = mdxSource(page)
    .replaceAll(/\n{3,}/g, "\n\n")
    .trimStart()
  return body.startsWith("# ") ? body : `# ${page.data.title}\n\n${body}`
}
