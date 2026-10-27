import type { APIRoute } from "astro"
import { createFromSource } from "fumadocs-core/search/server"
import { pageHref, source, structuredData } from "../../lib/docs/source.js"

const server = createFromSource(source, {
  buildIndex: (page) => ({
    id: pageHref(page),
    title: page.data.title,
    description: page.data.description,
    structuredData: structuredData(page),
    url: pageHref(page),
  }),
})

export const GET: APIRoute = () => server.staticGET()
