import { useEffect, useState } from "react"

export type LiveViewStatus = "connecting" | "playing" | "failed"

// oxlint-disable-next-line ren/no-comments -- Kernel's live view connects in up to 48 seconds and posts KERNEL_PLAYING once frames render. Frames that pause get the same time to come back. A failed connect is final for that frame: Kernel's client can post KERNEL_PLAYING right after it, with no frames.
const playingTimeoutMs = 60_000

export function useLiveView(src: string) {
  const [state, setState] = useState<{ readonly src: string; readonly status: LiveViewStatus }>({
    src,
    status: "connecting",
  })
  useEffect(() => {
    const origin = new URL(src).origin
    const watch = { timer: setTimeout(() => fail(), playingTimeoutMs), failed: false }
    const fail = () => {
      clearTimeout(watch.timer)
      watch.failed = true
      setState({ src, status: "failed" })
    }
    const listener = (event: MessageEvent<unknown>) => {
      if (watch.failed || event.origin !== origin || typeof event.data !== "object" || event.data === null) return
      const type = "type" in event.data ? event.data.type : undefined
      if (type === "KERNEL_CONNECTION_FAILED" || type === "KERNEL_CONNECTION_TIMEOUT") fail()
      if (type === "KERNEL_PLAYING") {
        clearTimeout(watch.timer)
        setState({ src, status: "playing" })
      }
      if (type === "KERNEL_PAUSED") {
        clearTimeout(watch.timer)
        watch.timer = setTimeout(() => fail(), playingTimeoutMs)
        setState({ src, status: "connecting" })
      }
    }
    window.addEventListener("message", listener)
    return () => {
      clearTimeout(watch.timer)
      window.removeEventListener("message", listener)
    }
  }, [src])
  return state.src === src ? state.status : "connecting"
}
