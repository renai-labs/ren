import { useEffect, useState } from "react"
import { Option, Schema } from "effect"
import { Platform } from "../platform/platform.js"

const themeVariables = [
  "--background",
  "--foreground",
  "--muted",
  "--muted-foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--primary",
  "--primary-foreground",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--radius",
  "--font-sans",
  "--font-mono",
] as const

const FrameMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ready") }),
  Schema.Struct({ type: Schema.Literal("size"), height: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("open-link"), href: Schema.String }),
  Schema.Struct({ type: Schema.Literal("open-image"), src: Schema.String, alt: Schema.String }),
])
const decodeFrameMessage = Schema.decodeUnknownOption(FrameMessage)

export function usePageFrame(options: {
  readonly zoom: number
  readonly onImage: (image: { readonly src: string; readonly alt: string }) => void
  readonly onHeight?: ((height: number) => void) | undefined
}) {
  const platform = Platform.usePlatform()
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [ready, setReady] = useState(false)
  const zoom = options.zoom
  const onImage = options.onImage
  const onHeight = options.onHeight
  useEffect(() => {
    if (!frame) return
    const post = (message: unknown) => frame.contentWindow?.postMessage(message, "*")
    const postTheme = () => {
      const style = getComputedStyle(document.documentElement)
      post({
        type: "theme",
        scheme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        vars: Object.fromEntries(themeVariables.map((name) => [name, style.getPropertyValue(name).trim()])),
      })
    }
    const received = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      const decoded = decodeFrameMessage(event.data)
      if (Option.isNone(decoded)) return
      const message = decoded.value
      if (message.type === "ready") {
        postTheme()
        post({ type: "zoom", level: zoom / 100 })
      }
      if (message.type === "size") {
        frame.style.height = `${message.height}px`
        onHeight?.(message.height)
        setReady(true)
      }
      if (
        message.type === "open-link" &&
        navigator.userActivation.isActive &&
        URL.canParse(message.href) &&
        new URL(message.href).protocol === "https:"
      )
        platform.openExternal(message.href)
      if (message.type === "open-image" && message.src.startsWith("data:image/"))
        onImage({ src: message.src, alt: message.alt })
    }
    const theme = new MutationObserver(postTheme)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    window.addEventListener("message", received)
    post({ type: "zoom", level: zoom / 100 })
    return () => {
      theme.disconnect()
      window.removeEventListener("message", received)
    }
  }, [frame, zoom, onImage, onHeight, platform])
  return [setFrame, ready] as const
}
