import type { APIRoute } from "astro"

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *\n\nSitemap: ${import.meta.env.SITE}/sitemap-index.xml\nSitemap: ${import.meta.env.SITE}/sitemap-registry.xml\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  )
