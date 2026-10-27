import { navGroups } from "./nav.js"
import { markdownBody, pageHref } from "./source.js"

const DESCRIPTION =
  "Ren runs AI agents for your team. Send Ren work from the app, Slack, Linear, or a schedule. Then review what it did in one place."

const CODE_FENCE = /^```[\s\S]*?^```\n?/gm

const absolute = (path: string) => new URL(path, import.meta.env.SITE).href

const text = (body: string) =>
  new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })

export const index = () =>
  text(
    [
      "# Ren",
      "",
      `> ${DESCRIPTION}`,
      "",
      ...navGroups().flatMap((group) => [
        `## ${group.title}`,
        "",
        group.pages
          .map((page) => `- [${page.data.title}](${absolute(pageHref(page))}): ${page.data.description}`)
          .join("\n"),
        "",
      ]),
      "## Documentation sets",
      "",
      `- [Complete documentation](${absolute("/llms-full.txt")}): every page as Markdown in one file`,
      `- [Abridged documentation](${absolute("/llms-small.txt")}): every page without code samples`,
      "",
      "Append `.md` to a page under /raw/ to get it as Markdown, for example /raw/docs/concepts/tasks.md.",
      "",
    ].join("\n"),
  )

export function fullText(options: { withCode: boolean }) {
  const pages = navGroups()
    .flatMap((group) => group.pages)
    .map((page) => {
      const body = markdownBody(page)
      return `<page url="${absolute(pageHref(page))}">\n${options.withCode ? body : body.replaceAll(CODE_FENCE, "")}\n</page>`
    })
  return text(`# Ren documentation\n\n> ${DESCRIPTION}\n\n${pages.join("\n\n")}\n`)
}
