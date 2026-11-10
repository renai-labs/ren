import { useEffect, useState } from "react"

export type LiveViewStatus = "connecting" | "playing" | "failed"

// oxlint-disable-next-line ren/no-comments -- Kernel's live view connects in up to 48 seconds and posts KERNEL_PLAYING once frames render; a failed connect posts one terminal event and stops. Frames that pause get the same time to come back.
const playingTimeoutMs = 60_000

export function useLiveView(src: string) {
  const [state, setState] = useState<{ readonly src: string; readonly status: LiveViewStatus }>({
    src,
    status: "connecting",
  })
  useEffect(() => {
    const origin = new URL(src).origin
    const timer = { current: setTimeout(() => setState({ src, status: "failed" }), playingTimeoutMs) }
    const listener = (event: MessageEvent<unknown>) => {
      if (event.origin !== origin || typeof event.data !== "object" || event.data === null) return
      const type = "type" in event.data ? event.data.type : undefined
      if (type === "KERNEL_PLAYING") {
        clearTimeout(timer.current)
        setState({ src, status: "playing" })
      }
      if (type === "KERNEL_PAUSED") {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setState({ src, status: "failed" }), playingTimeoutMs)
        setState({ src, status: "connecting" })
      }
      if (type === "KERNEL_CONNECTION_FAILED" || type === "KERNEL_CONNECTION_TIMEOUT") {
        clearTimeout(timer.current)
        setState({ src, status: "failed" })
      }
    }
    window.addEventListener("message", listener)
    return () => {
      clearTimeout(timer.current)
      window.removeEventListener("message", listener)
    }
  }, [src])
  return state.src === src ? state.status : "connecting"
}
