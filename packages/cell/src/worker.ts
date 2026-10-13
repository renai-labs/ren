export { SessionCell } from "./session-cell.js"

// oxlint-disable-next-line import/no-default-export -- workerd, celld and Cloudflare load the worker's default export
export default {
  fetch: () => new Response(null, { status: 401 }),
} satisfies ExportedHandler
