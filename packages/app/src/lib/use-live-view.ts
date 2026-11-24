import { type RefObject, useEffect, useEffectEvent, useRef, useState, useTransition } from "react"

const playingTimeoutMs = 60_000

const failures = new Set(["KERNEL_CONNECTION_FAILED", "KERNEL_CONNECTION_TIMEOUT"])

const typeOf = (data: unknown) =>
  typeof data === "object" && data !== null && "type" in data ? String(data.type) : undefined

export function useLiveView(
  frame: RefObject<HTMLIFrameElement | null>,
  src: string,
  ren: { readonly running: boolean; readonly stop: () => Promise<unknown> },
) {
  const origin = new URL(src).origin
  const [state, setState] = useState<{ src: string; status: "connecting" | "playing" | "failed" }>({
    src,
    status: "connecting",
  })
  const acknowledged = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    const watch = { failed: false, timer: setTimeout(() => fail(), playingTimeoutMs) }
    const fail = () => {
      clearTimeout(watch.timer)
      watch.failed = true
      setState({ src, status: "failed" })
    }
    const played = (type: string | undefined) => {
      if (failures.has(type ?? "")) fail()
      if (type === "KERNEL_PLAYING" || type === "KERNEL_PAUSED") clearTimeout(watch.timer)
      if (type === "KERNEL_PLAYING") setState({ src, status: "playing" })
      if (type !== "KERNEL_PAUSED") return
      watch.timer = setTimeout(() => fail(), playingTimeoutMs)
      setState({ src, status: "connecting" })
    }
    const listener = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return
      const type = typeOf(event.data)
      if (type === "KERNEL_READ_ONLY_CHANGED") acknowledged.current?.()
      if (!watch.failed) played(type)
    }
    window.addEventListener("message", listener)
    return () => {
      clearTimeout(watch.timer)
      window.removeEventListener("message", listener)
    }
  }, [src, origin, frame])
  const setReadOnly = (readOnly: boolean) =>
    frame.current?.contentWindow?.postMessage({ type: "KERNEL_SET_READ_ONLY", readOnly }, origin)
  const readOnly = (value: boolean) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The browser didn’t answer. Try again.")), 10_000)
      acknowledged.current = () => {
        clearTimeout(timer)
        resolve()
      }
      setReadOnly(value)
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
    setReadOnly(true)
  })
  useEffect(() => {
    if (!controlled) lock()
  }, [controlled])
  return {
    status: state.src === src ? state.status : "connecting",
    controlled,
    pending,
    toggle: (onError: (error: unknown) => void) =>
      startTransition(() =>
        (controlled ? Promise.resolve() : ren.stop())
          .then(() => readOnly(controlled))
          .then(() => {
            writable.current = !controlled
            setControlled(!controlled)
            if (!controlled) frame.current?.focus()
          }, onError),
      ),
  }
}
