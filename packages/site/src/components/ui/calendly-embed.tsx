import { useEffect, useRef } from "react"
import { CALENDLY_URL } from "../../lib/links.js"

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]

declare global {
  interface Window {
    Calendly?: { initInlineWidget: (options: { url: string; parentElement: HTMLElement }) => void }
  }
}

export function CalendlyEmbed() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const incoming = new URLSearchParams(window.location.search)
    const query = new URLSearchParams([
      ...UTM_KEYS.flatMap((key) => {
        const value = incoming.get(key)
        return value ? [[key, value]] : []
      }),
      ["hide_event_type_details", "1"],
      ["hide_gdpr_banner", "1"],
      ["background_color", "1a1a1a"],
      ["text_color", "ffffff"],
    ])

    const stylesheet = Object.assign(document.createElement("link"), {
      rel: "stylesheet",
      href: "https://assets.calendly.com/assets/external/widget.css",
    })
    const script = Object.assign(document.createElement("script"), {
      src: "https://assets.calendly.com/assets/external/widget.js",
      async: true,
    })
    script.addEventListener("load", () => {
      if (container.current)
        window.Calendly?.initInlineWidget({ url: `${CALENDLY_URL}?${query}`, parentElement: container.current })
    })
    document.head.append(stylesheet)
    document.body.append(script)
  }, [])

  return <div ref={container} className="h-[700px] w-full min-w-[320px]" aria-label="Schedule a demo" />
}
