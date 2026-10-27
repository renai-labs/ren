import { useEffect, useRef } from "react"
import { readNotify } from "@/stores/ui"

export const askToNotify = () => {
  if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission()
}

export function useAttentionNotification(input: {
  readonly running: boolean
  readonly asking: boolean
  readonly title: string
}) {
  const previous = useRef({ running: input.running, asking: input.asking })
  useEffect(() => {
    const before = previous.current
    previous.current = { running: input.running, asking: input.asking }
    const finished = before.running && !input.running
    const asked = !before.asking && input.asking
    if (!(finished || asked) || !readNotify() || document.visibilityState === "visible") return
    if (!("Notification" in window) || Notification.permission !== "granted") return
    const notification = new Notification(input.title, { body: asked ? "Ren needs your input." : "Ren finished." })
    notification.addEventListener("click", () => {
      window.focus()
      notification.close()
    })
  }, [input.running, input.asking, input.title])
}
