export default {
  async fetch(request, env) {
    const host = new URL(request.url).hostname
    const label = host.endsWith(`.${env.DOMAIN}`) ? host.slice(0, -env.DOMAIN.length - 1) : ""
    if (!/^art-[0-9a-z]{1,59}$/.test(label)) return new Response("No artifact here", { status: 404 })
    try {
      return await env.ARTIFACTS.get(label).fetch(request)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Worker not found"))
        return new Response("No artifact here", { status: 404 })
      throw error
    }
  },
}
