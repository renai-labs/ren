import { useEffect, useState } from "react"
import { Icon } from "./icon.js"
import { IconButton } from "./icon-button.js"
import type { IconButtonSize } from "./icon-button.js"

type CopyStatus = "idle" | "copied" | "failed"

export function CopyButton(props: {
  value: string
  onCopy: (value: string) => void | Promise<void>
  label?: string
  size?: IconButtonSize
}) {
  const [status, setStatus] = useState<CopyStatus>("idle")
  useEffect(() => {
    if (status !== "copied") return
    const timer = setTimeout(() => setStatus("idle"), 2000)
    return () => clearTimeout(timer)
  }, [status])
  return (
    <IconButton
      size={props.size}
      label={{ idle: props.label ?? "Copy", copied: "Copied", failed: "Copy failed. Try again" }[status]}
      onClick={(event) => {
        event.stopPropagation()
        void Promise.resolve(props.value)
          .then(props.onCopy)
          .then(
            () => setStatus("copied"),
            () => setStatus("failed"),
          )
      }}
    >
      <Icon glyph={status === "copied" ? "Check" : "Copy"} />
    </IconButton>
  )
}
