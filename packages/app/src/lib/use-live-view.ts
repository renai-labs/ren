import { type RefObject, useEffect, useEffectEvent, useRef, useState, useTransition } from "react"

export type LiveViewStatus = "connecting" | "playing" | "failed"

// oxlint-disable-next-line ren/no-comments -- Kernel's live view connects in up to 48 seconds and posts KERNEL_PLAYING once frames render; paused frames get the same time back. A failed connect is final for that frame: Kernel can post KERNEL_PLAYING right after it, with no frames.
const playingTimeoutMs = 60_000

const failures = new Set(["KERNEL_CONNECTION_FAILED", "KERNEL_CONNECTION_TIMEOUT"])

const typeOf = (data: unknown) =>
  typeof data === "object" && data !== null && "type" in data ? String(data.type) : undefined

// oxlint-disable-next-line ren/no-comments -- Kernel's embedded live view: its playing state, and the person's control. Taking control stops Ren's turn and lets the view take input (KERNEL_SET_READ_ONLY, acknowledged with KERNEL_READ_ONLY_CHANGED); a new turn gives control back to Ren.
export function useLiveView(
  frame: RefObject<HTMLIFrameElement | null>,
  src: string,
  ren: { readonly running: boolean; readonly stop: () => Promise<unknown> },
) {
  const [state, setState] = useState<{ src: string; status: LiveViewStatus }>({ src, status: "connecting" })
  const acknowledged = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    const origin = new URL(src).origin
    const watch = { failed: false, timer: setTimeout(() => fail(), playingTimeoutMs) }
    const fail = () => {
      clearTimeout(watch.timer)
      watch.failed = true
      setState({ src, status: "failed" })
    }
    const listener = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return
      const type = typeOf(event.data)
      if (type === "KERNEL_READ_ONLY_CHANGED") acknowledged.current?.()
      if (!watch.failed) played(type)
    }
    const played = (type: string | undefined) => {
      if (failures.has(type ?? "")) fail()
      if (type === "KERNEL_PLAYING" || type === "KERNEL_PAUSED") clearTimeout(watch.timer)
      if (type === "KERNEL_PLAYING") setState({ src, status: "playing" })
      if (type !== "KERNEL_PAUSED") return
      watch.timer = setTimeout(() => fail(), playingTimeoutMs)
      setState({ src, status: "connecting" })
    }
    window.addEventListener("message", listener)
    return () => {
      clearTimeout(watch.timer)
      window.removeEventListener("message", listener)
    }
  }, [src, frame])
  const readOnly = (value: boolean) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The browser didn’t answer. Try again.")), 10_000)
      acknowledged.current = () => {
        clearTimeout(timer)
        resolve()
      }
      frame.current?.contentWindow?.postMessage({ type: "KERNEL_SET_READ_ONLY", readOnly: value }, origin(src))
    })
  const [controlled, setControlled] = useState(false)
  const [pending, startTransition] = useTransition()
  const [turn, setTurn] = useState(ren.running)
  if (ren.running !== turn) {
    setTurn(ren.running)
    if (ren.running) setControlled(false)
  }
  const writable = useRef(false)
  const lock = useEffectEvent(() => {
    if (!writable.current) return
    writable.current = false
    frame.current?.contentWindow?.postMessage({ type: "KERNEL_SET_READ_ONLY", readOnly: true }, origin(src))
  })
  useEffect(() => {
    if (!controlled) lock()
  }, [controlled])
  return {
    status: state.src === src ? state.status : "connecting",
    controlled,
    pending,
    toggle: (onError: (error: unknown) => void) =>
      startTransition(async () => {
        try {
          if (!controlled) await ren.stop()
          await readOnly(controlled)
          writable.current = !controlled
          setControlled(!controlled)
          if (!controlled) frame.current?.focus()
        } catch (error) {
          onError(error)
        }
      }),
  }
}

const origin = (src: string) => new URL(src).origin
