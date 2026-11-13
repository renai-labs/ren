export * as HtmlPageBridge from "./html-page-bridge.js"

export const maxPageBytes = 5 * 1024 * 1024

export const policy = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join("; ")

export const script = `(() => {
  const root = document.documentElement
  const defaults = document.createElement("style")
  defaults.textContent = ":where(html){background:var(--background);color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif)}"
  document.head.append(defaults)
  const send = (message) => parent.postMessage(message, "*")
  let last = -1
  const measure = () => {
    const body = document.body
    if (!body) return
    const height = Math.ceil(body.getBoundingClientRect().bottom + scrollY + (parseFloat(getComputedStyle(body).marginBottom) || 0))
    if (height === last) return
    last = height
    send({ type: "size", height })
  }
  addEventListener("message", (event) => {
    if (event.source !== parent) return
    const message = event.data
    if (message?.type === "theme") {
      Object.entries(message.vars).forEach(([name, value]) => root.style.setProperty(name, String(value)))
      root.style.colorScheme = message.scheme
    }
    if (message?.type === "zoom") root.style.zoom = String(message.level)
    requestAnimationFrame(measure)
  })
  addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null
    const link = target?.closest("a[href]")
    const href = link?.getAttribute("href")
    if (link && href && !href.startsWith("#")) {
      event.preventDefault()
      send({ type: "open-link", href })
      return
    }
    const image = target?.closest("img")
    if (image) send({ type: "open-image", src: image.currentSrc || image.src, alt: image.alt })
  }, true)
  addEventListener("DOMContentLoaded", () => {
    new ResizeObserver(measure).observe(document.body)
    send({ type: "ready" })
  })
  addEventListener("load", measure)
})()`
