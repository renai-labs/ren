import { useEffect, useState } from "react"
import { Button } from "./button.js"
import { Icon } from "./icon.js"

type CopyStatus = "idle" | "copied" | "failed"

export type CopyButtonSize = "extra-small" | "compact" | "small" | "medium" | "large"

const sizes = {
  "extra-small": "icon-xs",
  compact: "icon-sm",
  small: "icon-sm",
  medium: "icon",
  large: "icon-lg",
} as const

export function CopyButton(props: {
  value: string
  onCopy: (value: string) => void | Promise<void>
  label?: string
  size?: CopyButtonSize | undefined
}) {
  const [status, setStatus] = useState<CopyStatus>("idle")
  useEffect(() => {
    if (status !== "copied") return
    const timer = setTimeout(() => setStatus("idle"), 2000)
    return () => clearTimeout(timer)
  }, [status])
  return (
    <Button
      variant="ghost"
      size={sizes[props.size ?? "small"]}
      className="text-muted-foreground"
      aria-label={{ idle: props.label ?? "Copy", copied: "Copied", failed: "Copy failed. Try again" }[status]}
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
      <Icon
        glyph={status === "copied" ? "Check" : "Copy"}
        size={props.size === "extra-small" ? "extra-small" : "small"}
      />
    </Button>
  )
}
