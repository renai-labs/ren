/* oxlint-disable import/no-default-export, typescript/no-unsafe-argument, typescript/no-unsafe-member-access, typescript/no-unsafe-assignment, typescript/no-unsafe-return, typescript/no-unsafe-call -- Executable JavaScript fixture: Cloudflare supplies request/env types and requires a default Worker export; SAMPLE_VERSION is replaced by Wrangler. */
export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname
    if (path === "/api/metrics")
      return Response.json({
        requests: 18420,
        availability: 99.98,
        latency: 142,
        version: typeof SAMPLE_VERSION === "undefined" ? "1" : SAMPLE_VERSION,
      })
    if (path.startsWith("/api/")) return Response.json({ error: "Unknown API route" }, { status: 404 })
    return env.ASSETS.fetch(request)
  },
}
