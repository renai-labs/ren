import type { APIRoute, GetStaticPaths } from "astro"
import { type DocsPage, markdownBody, source } from "../../lib/docs/source.js"

export const getStaticPaths: GetStaticPaths = () =>
  source.getPages().map((page) => ({
    params: { slug: ["docs", ...page.slugs].join("/") },
    props: { page },
  }))

export const GET: APIRoute<{ page: DocsPage }> = (context) =>
  new Response(markdownBody(context.props.page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  })
