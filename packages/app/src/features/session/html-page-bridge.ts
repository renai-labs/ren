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

// oxlint-disable-next-line ren/no-comments -- The page reports its height only once it wears the app's theme: a height measured before is a few pixels off, and the chat around it would bounce.
export const script = `(() => {
  const root = document.documentElement
  const defaults = document.createElement("style")
  defaults.textContent = ":where(html){box-sizing:border-box;padding:8px;background:var(--background);color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}html::-webkit-scrollbar{display:none}:where(body){margin:0}:where(code,kbd,pre,samp){font-family:var(--font-mono,ui-monospace,monospace)}:where(:focus-visible){outline:2px solid var(--ring);outline-offset:-2px}:where(img:not(a[href] img,button img)){cursor:zoom-in}"
  document.head.append(defaults)
  const send = (message) => parent.postMessage(message, "*")
  let last = -1
  let themed = false
  const measure = () => {
    if (!themed) return
    const height = Math.ceil(root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height)
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
      themed = true
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
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(document.body)
    send({ type: "ready" })
  })
  addEventListener("load", measure)
})()`
