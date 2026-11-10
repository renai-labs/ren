import { useEffect, useState } from "react"

export type LiveViewStatus = "connecting" | "playing" | "failed"

// oxlint-disable-next-line ren/no-comments -- Kernel's live view connects in up to 48 seconds and posts KERNEL_PLAYING once frames render; a failed connect posts one terminal event and stops.
const playingTimeoutMs = 60_000

export function useLiveView(src: string) {
  const [state, setState] = useState<{ readonly src: string; readonly status: LiveViewStatus }>({
    src,
    status: "connecting",
  })
  useEffect(() => {
    const origin = new URL(src).origin
    const timer = setTimeout(() => setState({ src, status: "failed" }), playingTimeoutMs)
    const listener = (event: MessageEvent<unknown>) => {
      if (event.origin !== origin || typeof event.data !== "object" || event.data === null) return
      const type = "type" in event.data ? event.data.type : undefined
      if (type === "KERNEL_PLAYING") {
        clearTimeout(timer)
        setState({ src, status: "playing" })
      }
      if (type === "KERNEL_CONNECTION_FAILED" || type === "KERNEL_CONNECTION_TIMEOUT") {
        clearTimeout(timer)
        setState({ src, status: "failed" })
      }
    }
    window.addEventListener("message", listener)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("message", listener)
    }
  }, [src])
  return state.src === src ? state.status : "connecting"
}
