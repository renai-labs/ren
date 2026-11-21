import { useRef, type RefObject } from "react"
import { Keyboard } from "../../platform/keyboard.js"
import { ChatKeys } from "./chat-keys.js"
import type { TranscriptHandle } from "./transcript.js"

const dockControls =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

function focus(
  refs: { readonly composer: HTMLTextAreaElement | null; readonly dock: HTMLElement | null },
  event: KeyboardEvent,
  options: { readonly dock: boolean },
) {
  const field = refs.composer
  const control = field ?? (options.dock ? refs.dock?.querySelector<HTMLElement>(dockControls) : null)
  if (!control) return
  if (options.dock) event.preventDefault()
  control.focus()
  field?.setSelectionRange(field.value.length, field.value.length)
}

function scroll(transcript: RefObject<TranscriptHandle | null>, event: KeyboardEvent, action: ChatKeys.Capture) {
  if (!transcript.current) return
  event.preventDefault()
  if (action === "jump") transcript.current.toEnd()
  else transcript.current.page(action === "pageUp" ? -1 : 1)
}

export function useChatKeys() {
  const composer = useRef<HTMLTextAreaElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const transcript = useRef<TranscriptHandle>(null)
  Keyboard.useKeyDown((event) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    const action = ChatKeys.capture(event, target, { composer: target !== null && target === composer.current })
    if (!action) return
    if (action === "type" || action === "focus")
      return focus({ composer: composer.current, dock: dock.current }, event, { dock: action === "focus" })
    scroll(transcript, event, action)
  })
  return {
    transcript,
    composer: (node: HTMLTextAreaElement | null) => {
      composer.current = node
    },
    dock: (node: HTMLDivElement | null) => {
      dock.current = node
    },
  }
}
