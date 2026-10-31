import { useEffect, useRef } from "react"
import { Platform } from "../platform/platform.js"
import { ChatPreferences } from "./chat-preferences.js"

export function useAttentionNotification(input: {
  readonly running: boolean
  readonly asking: boolean
  readonly title: string
}) {
  const platform = Platform.usePlatform()
  const previous = useRef({ running: input.running, asking: input.asking })
  useEffect(() => {
    const before = previous.current
    previous.current = { running: input.running, asking: input.asking }
    const finished = before.running && !input.running
    const asked = !before.asking && input.asking
    if (!(finished || asked) || !ChatPreferences.notify.read(platform.storage)) return
    void platform.notify(input.title, asked ? "Ren needs your input." : "Ren finished.")
  }, [platform, input.running, input.asking, input.title])
}
